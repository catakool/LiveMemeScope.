import { cacheGet, cacheGetStale, cacheSet, withCoalescing } from "./cache";

export type TrendImpact = "positive" | "negative" | "neutral";
export type TrendCategory = "influencer" | "listing" | "regulation" | "security" | "adoption" | "market" | "other";

export type TrendProvider = "gdelt" | "google_news_rss";

export interface TrendArticle {
  id: string;
  title: string;
  url: string;
  domain: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  language: string | null;
  sourceCountry: string | null;
  provider: TrendProvider;
  category: TrendCategory;
  impact: TrendImpact;
  strength: number;
  catalystLabels: string[];
}

export interface TrendsFeed {
  articles: TrendArticle[];
  generatedAt: string;
  source: "gdelt" | "rss" | "mixed";
  status: "live" | "stale" | "unavailable";
  providers: {
    gdelt: "live" | "unavailable";
    rss: "live" | "unavailable";
  };
  error?: string;
}

interface GdeltArticle {
  url?: unknown;
  url_mobile?: unknown;
  title?: unknown;
  seendate?: unknown;
  socialimage?: unknown;
  domain?: unknown;
  language?: unknown;
  sourcecountry?: unknown;
}

interface GdeltResponse {
  articles?: unknown;
}

const CACHE_KEY = "trends:gdelt:v1";
const CACHE_TTL_MS = 5 * 60_000;
const GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";

// Mantemos a pesquisa relativamente ampla. A classificação fina é feita localmente
// para não transformar uma palavra solta numa recomendação de investimento.
const SEARCH_QUERIES = [
  'cryptocurrency',
  '(bitcoin OR ethereum OR solana OR dogecoin OR memecoin)',
  '("meme coin" OR "meme token" OR crypto)',
] as const;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseGdeltDate(raw: string | null): string | null {
  if (!raw) return null;
  // GDELT costuma devolver YYYYMMDDTHHMMSSZ. Também aceitamos ISO diretamente.
  if (/^\d{8}T\d{6}Z$/.test(raw)) {
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function classifyArticle(title: string, publishedAt: string | null): Pick<TrendArticle, "category" | "impact" | "strength" | "catalystLabels"> {
  const t = title.toLowerCase();
  let category: TrendCategory = "other";
  let impact: TrendImpact = "neutral";
  let strength = 30;
  const catalystLabels: string[] = [];

  const add = (label: string, points: number) => {
    if (!catalystLabels.includes(label)) catalystLabels.push(label);
    strength += points;
  };

  if (/elon musk|musk\b/.test(t)) {
    category = "influencer";
    add("Menção de Elon Musk", 28);
  }
  if (/\b(listing|listed|lists|launchpool|launchpad)\b/.test(t) && /binance|coinbase|kraken|okx|bybit|exchange/.test(t)) {
    category = "listing";
    impact = "positive";
    add("Listing / exchange", 28);
  }
  if (/etf|approval|approved|institutional|adoption|payments?|integration|partnership/.test(t)) {
    if (category === "other") category = "adoption";
    if (impact === "neutral") impact = "positive";
    add("Adoção / catalisador institucional", 14);
  }
  if (/hack|hacked|exploit|breach|drain|stolen|scam|rug pull|rugpull|delist|delisting|lawsuit|probe|ban\b/.test(t)) {
    category = "security";
    impact = "negative";
    add("Risco / segurança", 30);
  }
  if (/sec\b|regulat|legislation|lawmakers?|government|court|legal/.test(t)) {
    if (category === "other") category = "regulation";
    add("Regulação", 16);
  }
  if (/surge|soar|rally|jumps?|spike|record high|breakout/.test(t)) {
    if (impact === "neutral") impact = "positive";
    if (category === "other") category = "market";
    add("Movimento forte de mercado", 10);
  }
  if (/crash|plunge|slump|selloff|sell-off|falls?|drops?|collapse/.test(t)) {
    impact = "negative";
    if (category === "other") category = "market";
    add("Pressão negativa de mercado", 12);
  }

  if (publishedAt) {
    const ageMs = Date.now() - new Date(publishedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0) {
      if (ageMs <= 60 * 60_000) strength += 22;
      else if (ageMs <= 3 * 60 * 60_000) strength += 16;
      else if (ageMs <= 6 * 60 * 60_000) strength += 10;
      else if (ageMs <= 12 * 60 * 60_000) strength += 5;
    }
  }

  return { category, impact, strength: Math.max(0, Math.min(100, Math.round(strength))), catalystLabels };
}

function normalizeArticles(json: GdeltResponse): TrendArticle[] {
  if (!Array.isArray(json.articles)) return [];
  const seen = new Set<string>();
  const out: TrendArticle[] = [];

  for (const raw of json.articles as GdeltArticle[]) {
    const title = asString(raw.title);
    const url = asString(raw.url) ?? asString(raw.url_mobile);
    if (!title || !url) continue;
    const dedupe = `${title.toLowerCase()}|${url}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const publishedAt = parseGdeltDate(asString(raw.seendate));
    const classified = classifyArticle(title, publishedAt);
    out.push({
      id: Buffer.from(url).toString("base64url").slice(0, 40),
      title,
      url,
      domain: asString(raw.domain),
      imageUrl: asString(raw.socialimage),
      publishedAt,
      language: asString(raw.language),
      sourceCountry: asString(raw.sourcecountry),
      provider: "gdelt",
      ...classified,
    });
  }

  return out.sort((a, b) => {
    const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return b.strength - a.strength || timeB - timeA;
  });
}


const GOOGLE_NEWS_RSS_QUERIES = [
  "cryptocurrency when:12h",
  "(dogecoin OR memecoin OR bitcoin OR ethereum OR solana) when:12h",
  "(crypto Binance OR crypto Coinbase OR crypto Elon Musk) when:12h",
] as const;

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .trim();
}

function xmlTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : null;
}

function domainFromUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function parseGoogleNewsRss(xml: string): TrendArticle[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const out: TrendArticle[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const title = xmlTag(item, "title");
    const url = xmlTag(item, "link");
    if (!title || !url) continue;

    const publishedRaw = xmlTag(item, "pubDate");
    const published = publishedRaw ? new Date(publishedRaw) : null;
    const publishedAt = published && !Number.isNaN(published.getTime()) ? published.toISOString() : null;

    // Google News RSS often includes <source url="...">Publication</source>.
    const sourceMatch = item.match(/<source\b[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/source>/i);
    const sourceUrl = sourceMatch ? decodeXml(sourceMatch[1]) : null;
    const sourceName = sourceMatch ? decodeXml(sourceMatch[2]) : null;

    const dedupe = `${title.toLowerCase()}|${url}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const classified = classifyArticle(title, publishedAt);
    out.push({
      id: Buffer.from(`rss:${url}`).toString("base64url").slice(0, 40),
      title,
      url,
      domain: sourceUrl ? domainFromUrl(sourceUrl) : sourceName,
      imageUrl: null,
      publishedAt,
      language: null,
      sourceCountry: null,
      provider: "google_news_rss",
      ...classified,
    });
  }

  return out;
}

async function fetchGoogleNewsRssQuery(query: string): Promise<TrendArticle[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.1",
        "User-Agent": "Mozilla/5.0 (compatible; MemeScope/1.0; +https://vercel.app)",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`RSS_HTTP_${res.status}`);
    const body = await res.text();
    if (!/<rss\b|<feed\b/i.test(body)) throw new Error("RSS_INVALID_XML");
    return parseGoogleNewsRss(body);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRssFallback(): Promise<TrendArticle[]> {
  const settled = await Promise.allSettled(
    GOOGLE_NEWS_RSS_QUERIES.map((query) => fetchGoogleNewsRssQuery(query))
  );

  const merged = new Map<string, TrendArticle>();
  let successes = 0;

  for (const result of settled) {
    if (result.status === "fulfilled") {
      successes += 1;
      for (const article of result.value) {
        const key = article.title.toLowerCase();
        const current = merged.get(key);
        if (!current || article.strength > current.strength) merged.set(key, article);
      }
    } else {
      console.warn("[MemeScope][Trends] RSS query failed:", result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  if (successes === 0) throw new Error("RSS_ALL_QUERIES_FAILED");
  return [...merged.values()];
}

async function fetchGdeltQuery(query: string, timespan = "12h"): Promise<TrendArticle[]> {
  const url = new URL(GDELT_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("maxrecords", "75");
  url.searchParams.set("timespan", timespan);
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("format", "json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json,text/plain;q=0.9,*/*;q=0.1",
        "User-Agent": "MemeScope/1.0",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GDELT_HTTP_${res.status}`);

    // GDELT occasionally returns an HTML/text error body with HTTP 200.
    // Read text first so one malformed response does not kill all retries.
    const body = await res.text();
    let json: GdeltResponse;
    try {
      json = JSON.parse(body) as GdeltResponse;
    } catch {
      throw new Error("GDELT_INVALID_JSON");
    }
    return normalizeArticles(json);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGdeltArticles(): Promise<TrendArticle[]> {
  const settled = await Promise.allSettled(
    SEARCH_QUERIES.map((query) => fetchGdeltQuery(query))
  );

  const merged = new Map<string, TrendArticle>();
  let successes = 0;

  for (const result of settled) {
    if (result.status === "fulfilled") {
      successes += 1;
      for (const article of result.value) {
        const key = `${article.title.toLowerCase()}|${article.url}`;
        const current = merged.get(key);
        if (!current || article.strength > current.strength) merged.set(key, article);
      }
    } else {
      console.warn("[MemeScope][Trends] GDELT query failed:", result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  if (successes === 0) throw new Error("GDELT_ALL_QUERIES_FAILED");
  return [...merged.values()];
}

function mergeProviderArticles(groups: TrendArticle[][]): TrendArticle[] {
  const merged = new Map<string, TrendArticle>();

  for (const group of groups) {
    for (const article of group) {
      // Dedupe mainly by normalized title because GDELT and Google News may
      // point to different wrapper URLs for the same story.
      const key = article.title.toLowerCase().replace(/\s+/g, " ").trim();
      const current = merged.get(key);
      if (!current || article.strength > current.strength) merged.set(key, article);
    }
  }

  return [...merged.values()]
    .sort((a, b) => {
      const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return b.strength - a.strength || timeB - timeA;
    })
    .slice(0, 100);
}

async function fetchLiveTrends(): Promise<TrendsFeed> {
  // Both providers start together. GDELT can be slow from some Vercel regions,
  // so an RSS provider can still return a useful feed without waiting 30s.
  const [gdeltResult, rssResult] = await Promise.allSettled([
    fetchGdeltArticles(),
    fetchRssFallback(),
  ]);

  const gdeltArticles = gdeltResult.status === "fulfilled" ? gdeltResult.value : [];
  const rssArticles = rssResult.status === "fulfilled" ? rssResult.value : [];

  if (gdeltResult.status === "rejected") {
    console.warn("[MemeScope][Trends] GDELT unavailable:", gdeltResult.reason instanceof Error ? gdeltResult.reason.message : String(gdeltResult.reason));
  }
  if (rssResult.status === "rejected") {
    console.warn("[MemeScope][Trends] RSS unavailable:", rssResult.reason instanceof Error ? rssResult.reason.message : String(rssResult.reason));
  }

  if (gdeltArticles.length === 0 && rssArticles.length === 0) {
    throw new Error("ALL_TREND_PROVIDERS_FAILED");
  }

  const articles = mergeProviderArticles([gdeltArticles, rssArticles]);
  const gdeltLive = gdeltArticles.length > 0;
  const rssLive = rssArticles.length > 0;

  return {
    articles,
    generatedAt: new Date().toISOString(),
    source: gdeltLive && rssLive ? "mixed" : gdeltLive ? "gdelt" : "rss",
    status: "live",
    providers: {
      gdelt: gdeltLive ? "live" : "unavailable",
      rss: rssLive ? "live" : "unavailable",
    },
  };
}

export async function getTrendsFeed(): Promise<TrendsFeed> {
  const cached = cacheGet<TrendsFeed>(CACHE_KEY);
  if (cached && cached.value.status === "live" && cached.value.articles.length > 0) {
    return cached.value;
  }

  try {
    const feed = await withCoalescing(CACHE_KEY, fetchLiveTrends);
    // Never cache unavailable/empty failures as a successful fresh result.
    if (feed.status === "live" && feed.articles.length > 0) {
      cacheSet(CACHE_KEY, feed, CACHE_TTL_MS);
    }
    return feed;
  } catch (error) {
    console.error(
      "[MemeScope][Trends] All providers unavailable:",
      error instanceof Error ? error.message : String(error)
    );

    const stale = cacheGetStale<TrendsFeed>(CACHE_KEY);
    if (stale && stale.value.articles.length > 0) {
      return {
        ...stale.value,
        status: "stale",
        generatedAt: new Date().toISOString(),
        error: "As fontes ao vivo falharam; a mostrar o último feed válido em cache.",
      };
    }

    return {
      articles: [],
      generatedAt: new Date().toISOString(),
      source: "mixed",
      status: "unavailable",
      providers: { gdelt: "unavailable", rss: "unavailable" },
      error: "Não foi possível obter notícias recentes neste momento.",
    };
  }
}
