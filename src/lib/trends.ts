import { cacheGet, cacheGetStale, cacheSet, withCoalescing } from "./cache";

export type TrendImpact = "positive" | "negative" | "neutral";
export type TrendCategory = "influencer" | "listing" | "regulation" | "security" | "adoption" | "market" | "other";

export interface TrendArticle {
  id: string;
  title: string;
  url: string;
  domain: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  language: string | null;
  sourceCountry: string | null;
  category: TrendCategory;
  impact: TrendImpact;
  strength: number;
  catalystLabels: string[];
}

export interface TrendsFeed {
  articles: TrendArticle[];
  generatedAt: string;
  source: "gdelt";
  status: "live" | "stale" | "unavailable";
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
const SEARCH_QUERY = '(cryptocurrency OR crypto OR bitcoin OR ethereum OR solana OR dogecoin OR memecoin OR "meme coin" OR "meme token")';

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
      ...classified,
    });
  }

  return out.sort((a, b) => {
    const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return b.strength - a.strength || timeB - timeA;
  });
}

async function fetchGdelt(): Promise<TrendsFeed> {
  const url = new URL(GDELT_ENDPOINT);
  url.searchParams.set("query", SEARCH_QUERY);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("maxrecords", "75");
  url.searchParams.set("timespan", "12h");
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("format", "json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "MemeScope/1.0 (+educational market dashboard)" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GDELT_HTTP_${res.status}`);
    const json = (await res.json()) as GdeltResponse;
    return {
      articles: normalizeArticles(json),
      generatedAt: new Date().toISOString(),
      source: "gdelt",
      status: "live",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getTrendsFeed(): Promise<TrendsFeed> {
  const cached = cacheGet<TrendsFeed>(CACHE_KEY);
  if (cached) return cached.value;

  try {
    const feed = await withCoalescing(CACHE_KEY, fetchGdelt);
    cacheSet(CACHE_KEY, feed, CACHE_TTL_MS);
    return feed;
  } catch {
    const stale = cacheGetStale<TrendsFeed>(CACHE_KEY);
    if (stale) return { ...stale.value, status: "stale", generatedAt: new Date().toISOString() };
    return {
      articles: [],
      generatedAt: new Date().toISOString(),
      source: "gdelt",
      status: "unavailable",
      error: "Não foi possível obter notícias recentes da GDELT neste momento.",
    };
  }
}
