"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DiscoveryRecord } from "@/lib/discovery";
import type { TrendArticle, TrendsFeed, TrendImpact } from "@/lib/trends";

const REFRESH_MS = 5 * 60_000;

function ageLabel(iso: string | null): string {
  if (!iso) return "hora desconhecida";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "agora";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return `há ${h} h`;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[$#]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const AMBIGUOUS_SYMBOLS = new Set([
  "one", "gas", "arb", "op", "near", "link", "uni", "cake", "ray", "people",
  "good", "wen", "dog", "cat", "meme", "token", "coin",
]);

function relatedTokens(article: TrendArticle, records: DiscoveryRecord[]): DiscoveryRecord[] {
  const normalizedTitle = ` ${normalize(article.title)} `;
  const rawTitle = article.title.toLowerCase();

  return records
    .filter((r) => {
      // Full project names are substantially safer than ticker-only matching.
      const name = normalize(r.def.name);
      const nameMatch = name.length >= 4 && normalizedTitle.includes(` ${name} `);
      if (nameMatch) return true;

      // A ticker by itself is ambiguous (PEPE/DOG/CAT/etc.). Only accept it
      // when the article explicitly uses a cashtag such as $DOGE/$PEPE.
      const symbol = r.def.symbol.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (symbol.length < 2 || AMBIGUOUS_SYMBOLS.has(symbol)) return false;
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\$${escaped}(?![a-z0-9])`, "i").test(rawTitle);
    })
    .slice(0, 4);
}

function ImpactPill({ impact }: { impact: TrendImpact }) {
  const cfg = impact === "positive"
    ? "border-[var(--accent-opportunity)]/40 text-[var(--accent-opportunity)]"
    : impact === "negative"
      ? "border-[var(--accent-risk)]/40 text-[var(--accent-risk)]"
      : "border-[var(--border)] text-[var(--text-muted)]";
  const label = impact === "positive" ? "Positivo" : impact === "negative" ? "Risco" : "Neutro";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] ${cfg}`}>{label}</span>;
}

function TrendCard({ article, records, onOpen }: { article: TrendArticle; records: DiscoveryRecord[]; onOpen: (key: string) => void }) {
  const linked = relatedTokens(article, records);
  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <ImpactPill impact={article.impact} />
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">{article.category}</span>
            <span className="text-[10px] text-[var(--text-faint)]">{ageLabel(article.publishedAt)}</span>
          </div>
          <a href={article.url} target="_blank" rel="noreferrer" className="font-display font-semibold text-sm hover:text-[var(--accent-info)] transition-colors">
            {article.title}
          </a>
          <div className="mt-1 text-[10px] text-[var(--text-faint)]">
            {article.domain ?? "Fonte desconhecida"}{article.sourceCountry ? ` · ${article.sourceCountry}` : ""}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-data text-xl font-bold text-[var(--accent-gold)]">{article.strength}</div>
          <div className="text-[9px] uppercase tracking-wide text-[var(--text-faint)]">força</div>
        </div>
      </div>

      {article.catalystLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {article.catalystLabels.map((label) => (
            <span key={label} className="rounded-md bg-[var(--surface-2)] px-2 py-1 text-[10px] text-[var(--text-muted)]">{label}</span>
          ))}
        </div>
      )}

      {linked.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-1.5">Tokens relacionados (correspondência verificada)</div>
          <div className="flex flex-wrap gap-1.5">
            {linked.map((r) => (
              <button
                key={r.def.tokenKey}
                onClick={() => onOpen(r.def.tokenKey)}
                className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent-opportunity)] hover:text-[var(--accent-opportunity)]"
              >
                {r.def.symbol}
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export default function TrendsPanel({ records, onOpen }: { records: DiscoveryRecord[]; onOpen: (key: string) => void }) {
  const [feed, setFeed] = useState<TrendsFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<"all" | TrendImpact>("all");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trends", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const json = (await res.json()) as TrendsFeed;
      setFeed(json);
      setError(json.error ?? null);
    } catch {
      setError("Não foi possível carregar as tendências agora.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const articles = feed?.articles ?? [];
    return impact === "all" ? articles : articles.filter((a) => a.impact === impact);
  }, [feed, impact]);

  const marketTrending = useMemo(() => {
    return records
      .filter((r) => r.discovery.reasons.includes("trending"))
      .sort((a, b) => (b.discovery.trendingScore ?? 0) - (a.discovery.trendingScore ?? 0))
      .slice(0, 10);
  }, [records]);

  const topLinked = useMemo(() => {
    const counts = new Map<string, { record: DiscoveryRecord; count: number; maxStrength: number }>();
    for (const article of feed?.articles ?? []) {
      for (const r of relatedTokens(article, records)) {
        const current = counts.get(r.def.tokenKey);
        counts.set(r.def.tokenKey, {
          record: r,
          count: (current?.count ?? 0) + 1,
          maxStrength: Math.max(current?.maxStrength ?? 0, article.strength),
        });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || b.maxStrength - a.maxStrength).slice(0, 8);
  }, [feed, records]);

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-[var(--accent-info)]/25 bg-gradient-to-b from-[var(--accent-info)]/5 to-transparent p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><span className="text-xl">📡</span><h2 className="font-display text-xl font-bold">Tendências</h2></div>
            <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
              Radar de notícias e catalisadores cripto recentes. Uma notícia não é uma ordem de compra: a confirmação de mercado continua a pertencer ao Opportunity Engine.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className={`rounded-full border px-2 py-1 ${feed?.status === "live" ? "border-[var(--accent-opportunity)]/40 text-[var(--accent-opportunity)]" : "border-[var(--accent-gold)]/40 text-[var(--accent-gold)]"}`}>
              {feed?.status === "live" ? "● Notícias LIVE" : feed?.status === "stale" ? "◐ Cache recente" : "○ Fonte indisponível"}
            </span>
            <span className="rounded-full border border-[var(--border)] px-2 py-1 text-[var(--text-muted)]">
              {feed?.source === "mixed" ? "GDELT + RSS · 12h" : feed?.source === "rss" ? "RSS fallback · 12h" : "GDELT · 12h"}
            </span>
          </div>
        </div>
      </div>

      {marketTrending.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Em tendência no mercado</div>
            <div className="text-[10px] text-[var(--text-faint)]">CoinGecko trending · identidade verificada</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {marketTrending.map((record) => (
              <button key={record.def.tokenKey} onClick={() => onOpen(record.def.tokenKey)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-left hover:border-[var(--accent-opportunity)]">
                <span className="font-data text-xs font-semibold">{record.def.symbol}</span>
                <span className="ml-2 text-[10px] text-[var(--text-faint)]">Discovery {record.scores.opportunity.score?.toFixed(0) ?? "N/D"}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {topLinked.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-2">Tokens mais mencionados nas notícias encontradas</div>
          <div className="flex flex-wrap gap-2">
            {topLinked.map(({ record, count, maxStrength }) => (
              <button key={record.def.tokenKey} onClick={() => onOpen(record.def.tokenKey)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-left hover:border-[var(--accent-info)]">
                <span className="font-data text-xs font-semibold">{record.def.symbol}</span>
                <span className="ml-2 text-[10px] text-[var(--text-faint)]">{count} menção{count === 1 ? "" : "ões"} · pico {maxStrength}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[var(--text-muted)]">{filtered.length} notícias/catalisadores</div>
        <div className="flex gap-1">
          {(["all", "positive", "negative", "neutral"] as const).map((v) => (
            <button key={v} onClick={() => setImpact(v)} className={`rounded-md border px-2.5 py-1 text-xs ${impact === v ? "border-[var(--accent-info)] text-[var(--accent-info)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
              {v === "all" ? "Todas" : v === "positive" ? "Positivas" : v === "negative" ? "Risco" : "Neutras"}
            </button>
          ))}
        </div>
      </div>

      {loading && !feed && <div className="text-sm text-[var(--text-muted)]">A procurar tendências recentes…</div>}
      {error && <div className="rounded-lg border border-[var(--accent-gold)]/40 bg-[var(--surface)] px-4 py-3 text-xs text-[var(--accent-gold)]">{error}</div>}

      {!loading && filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--text-muted)]">
          Não há notícias recentes que passem este filtro. O radar volta a consultar a fonte automaticamente.
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {filtered.map((article) => <TrendCard key={article.id} article={article} records={records} onOpen={onOpen} />)}
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[11px] text-[var(--text-faint)]">
        <strong className="text-[var(--text-muted)]">Como interpretar:</strong> “força” mede relevância heurística + recência do catalisador, não probabilidade de lucro nem sentimento financeiro garantido. O radar usa GDELT e um RSS de notícias como fallback; X/Twitter e Reddit continuam fora até existir uma fonte oficial configurada.
      </div>
    </section>
  );
}
