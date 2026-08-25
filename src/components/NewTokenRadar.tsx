"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  RadarCandidate,
  RadarFeed,
  RadarClassification,
  VisibleRadarSource,
  CoinGeckoHorizonStats,
} from "@/lib/newTokenRadar";
import { formatUsd, formatPercent } from "@/lib/format";
import { CHAIN_LABEL } from "@/lib/tiers";

type RadarFilter = "all" | RadarClassification;
type SourceFilter = "all" | VisibleRadarSource | "pre_coingecko";
type SortMode = "score" | "newest" | "momentum" | "liquidity";

const META: Record<RadarClassification, { label: string; icon: string; cls: string }> = {
  explosive: { label: "Explosive", icon: "🚨", cls: "text-[var(--accent-risk)] border-[var(--accent-risk)]/50" },
  breakout: { label: "Breakout", icon: "🔥", cls: "text-[var(--accent-gold)] border-[var(--accent-gold)]/50" },
  emerging: { label: "Emerging", icon: "👀", cls: "text-[var(--accent-info)] border-[var(--accent-info)]/50" },
  mature: { label: "DEX Mature", icon: "🌿", cls: "text-[var(--accent-opportunity)] border-[var(--accent-opportunity)]/50" },
};

function ageLabel(minutes: number) {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(minutes < 180 ? 1 : 0)} h`;
  return `${(minutes / 1440).toFixed(1)} d`;
}
function changeCls(v: number | null) {
  return v === null ? "text-[var(--text-muted)]" : v >= 0 ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-risk)]";
}
function dateTime(iso: string | null) {
  if (!iso) return "N/D";
  try { return new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }); }
  catch { return "N/D"; }
}

function SourceBadge({ c }: { c: RadarCandidate }) {
  if (c.visibleSource === "coingecko") {
    return <span className="rounded-full border border-[var(--accent-opportunity)]/45 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-opportunity)]">Source: CoinGecko</span>;
  }
  return <span className="rounded-full border border-[var(--accent-info)]/45 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-info)]">Source: DexScreener</span>;
}

function Card({ c }: { c: RadarCandidate }) {
  const m = META[c.classification];
  const tx = (c.buysM5 ?? 0) + (c.sellsM5 ?? 0);
  const buyRatio = tx > 0 ? (c.buysM5 ?? 0) / tx : null;
  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display font-semibold truncate">{c.name}</h3>
            <span className="font-data text-xs text-[var(--text-muted)]">${c.symbol}</span>
            {c.currentStatus === "live" ? (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.icon} {m.label}</span>
            ) : c.currentStatus === "stale" ? (
              <span className="rounded-full border border-[var(--text-faint)]/50 px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">⏸ Stale</span>
            ) : (
              <span className="rounded-full border border-[var(--text-faint)]/50 px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">↘ Lost Momentum</span>
            )}
            <SourceBadge c={c} />
            {c.isPreCoinGecko && <span className="rounded-full border border-[var(--accent-gold)]/45 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-gold)]">Pre-CoinGecko watch</span>}
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-faint)]">
            {CHAIN_LABEL[c.chain]} · par criado há {ageLabel(c.ageMinutes)} · MemeScope detetou há {ageLabel(c.detectedMinutesAgo)}
            {c.currentStatus !== "live" && <> · último dado {dateTime(c.lastSeenAt)}</>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-data text-xl font-bold">{c.earlyMomentumScore.toFixed(0)}</div>
          <div className="text-[9px] uppercase tracking-wider text-[var(--text-faint)]">{c.currentStatus === "live" ? "Early Momentum" : "Score atual"}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg bg-[var(--surface-2)] p-2"><div className="text-[var(--text-faint)]">5m</div><div className={`font-data font-semibold ${changeCls(c.priceChangeM5)}`}>{formatPercent(c.priceChangeM5)}</div></div>
        <div className="rounded-lg bg-[var(--surface-2)] p-2"><div className="text-[var(--text-faint)]">Volume 5m</div><div className="font-data font-semibold">{formatUsd(c.volumeM5, { compact: true })}</div></div>
        <div className="rounded-lg bg-[var(--surface-2)] p-2"><div className="text-[var(--text-faint)]">Liquidez</div><div className="font-data font-semibold">{formatUsd(c.liquidityUsd, { compact: true })}</div></div>
        <div className="rounded-lg bg-[var(--surface-2)] p-2"><div className="text-[var(--text-faint)]">{c.marketCapIsFdv ? "FDV*" : "Market cap"}</div><div className="font-data font-semibold">{formatUsd(c.marketCapOrFdv, { compact: true })}</div></div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
        <span>Buys/Sells 5m: <b className="font-data text-[var(--text)]">{c.buysM5 ?? "N/D"}/{c.sellsM5 ?? "N/D"}</b></span>
        {buyRatio !== null && <span>Compras: <b className="font-data text-[var(--text)]">{(buyRatio * 100).toFixed(0)}%</b></span>}
        <span>Desde deteção: <b className={`font-data ${changeCls(c.returnSinceDetected)}`}>{formatPercent(c.returnSinceDetected)}</b></span>
        <span>Pico desde deteção: <b className={`font-data ${changeCls(c.peakReturnSinceDetected)}`}>{formatPercent(c.peakReturnSinceDetected)}</b></span>
        <span>Origem: <b className="text-[var(--text)]">DexScreener</b></span>
      </div>

      {c.currentStatus !== "live" && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[10px] text-[var(--text-muted)]">
          <b className="text-[var(--text)]">Estado atual:</b> {c.currentStatus === "stale" ? "dados desatualizados" : "já não passa os filtros do Live Radar"}
          {c.currentStatusReason ? ` · ${c.currentStatusReason}` : ""}
          {c.lastQualifiedAt && <div className="mt-0.5">Última vez qualificado: {dateTime(c.lastQualifiedAt)}</div>}
        </div>
      )}

      {c.visibleSource === "coingecko" && (
        <div className="rounded-lg border border-[var(--accent-opportunity)]/25 bg-[var(--accent-opportunity-dim)]/25 p-2 text-[10px] text-[var(--text-muted)]">
          <div><b className="text-[var(--accent-opportunity)]">CoinGecko confirmado</b> · ID: <span className="font-data">{c.coingeckoId}</span></div>
          <div className="mt-0.5">Primeira confirmação pela MemeScope: {dateTime(c.coingeckoFirstSeenAt)}</div>
          {c.coingeckoTransitionObservedAt && <div className="mt-0.5 text-[var(--accent-gold)]">🔔 Transição DEX-only → CoinGecko observada em {dateTime(c.coingeckoTransitionObservedAt)}</div>}
        </div>
      )}

      {!!c.reasons.length && <div><div className="text-[10px] uppercase tracking-wider text-[var(--accent-opportunity)] mb-1">Por que apareceu?</div><ul className="space-y-1 text-[11px] text-[var(--text-muted)]">{c.reasons.slice(0, 5).map((r) => <li key={r}>• {r}</li>)}</ul></div>}
      {!!c.risks.length && <div className="rounded-lg border border-[var(--accent-risk)]/25 bg-[var(--accent-risk-dim)]/30 p-2"><div className="text-[10px] uppercase tracking-wider text-[var(--accent-risk)] mb-1">Risco</div><div className="text-[10px] text-[var(--text-muted)]">{c.risks.slice(0, 3).join(" · ")}</div></div>}

      <div className="flex items-center justify-between gap-2 pt-1">
        <code className="text-[9px] text-[var(--text-faint)] truncate max-w-[65%]" title={c.address}>{c.address}</code>
        <a href={c.dexUrl} target="_blank" rel="noreferrer" className="text-xs rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[var(--accent-info)] hover:border-[var(--accent-info)]/60">Ver na DexScreener ↗</a>
      </div>
    </article>
  );
}

function Horizon({ label, stats }: { label: string; stats: CoinGeckoHorizonStats }) {
  return <div className="rounded-lg bg-[var(--surface-2)] p-2.5">
    <div className="text-[10px] text-[var(--text-faint)]">{label}</div>
    <div className={`font-data text-sm font-semibold ${changeCls(stats.medianReturn)}`}>{stats.medianReturn === null ? "N/D" : `${stats.medianReturn >= 0 ? "+" : ""}${stats.medianReturn.toFixed(1)}%`}</div>
    <div className="text-[9px] text-[var(--text-faint)]">{stats.positiveRate === null ? "sem amostra" : `${stats.positiveRate.toFixed(0)}% positivos`} · n={stats.sampleSize}</div>
  </div>;
}

export default function NewTokenRadar() {
  const [feed, setFeed] = useState<RadarFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RadarFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sort, setSort] = useState<SortMode>("score");

  useEffect(() => {
    let cancelled = false;
    const load = () => fetch("/api/radar", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: RadarFeed) => { if (!cancelled) setFeed(j); })
      .catch(() => { if (!cancelled) setFeed(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    load();
    const timer = window.setInterval(load, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const candidates = useMemo(() => {
    const list = [...(feed?.candidates ?? [])].filter((c) => {
      if (filter !== "all" && c.classification !== filter) return false;
      if (sourceFilter === "coingecko" && c.visibleSource !== "coingecko") return false;
      if (sourceFilter === "dexscreener" && c.visibleSource !== "dexscreener") return false;
      if (sourceFilter === "pre_coingecko" && !c.isPreCoinGecko) return false;
      return true;
    });
    if (sort === "newest") list.sort((a, b) => a.ageMinutes - b.ageMinutes);
    else if (sort === "momentum") list.sort((a, b) => (b.priceChangeM5 ?? -Infinity) - (a.priceChangeM5 ?? -Infinity));
    else if (sort === "liquidity") list.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
    else list.sort((a, b) => b.earlyMomentumScore - a.earlyMomentumScore);
    return list;
  }, [feed, filter, sourceFilter, sort]);

  const recentCandidates = useMemo(() => {
    return [...(feed?.recentCandidates ?? [])]
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
  }, [feed]);

  const count = (c: RadarClassification) => feed?.candidates.filter((x) => x.classification === c).length ?? 0;
  const sourceCount = (source: VisibleRadarSource) => feed?.candidates.filter((x) => x.visibleSource === source).length ?? 0;
  const preCgCount = feed?.candidates.filter((x) => x.isPreCoinGecko).length ?? 0;

  return <section className="space-y-5">
    <div className="rounded-2xl border border-[var(--accent-info)]/30 bg-[var(--surface)] p-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><span className="text-xl">🚀</span><h2 className="font-display text-lg font-semibold">New Token Radar</h2><span className={`rounded-full border px-2 py-0.5 text-[10px] ${feed?.status === "live" ? "border-[var(--accent-opportunity)]/40 text-[var(--accent-opportunity)]" : "border-[var(--accent-risk)]/40 text-[var(--accent-risk)]"}`}>{feed?.status === "live" ? "LIVE" : "INDISPONÍVEL"}</span></div>
          <p className="mt-2 max-w-3xl text-xs text-[var(--text-muted)]">O <b>Live Radar</b> mostra apenas tokens que passam os gates agora. Quando deixam de passar, não desaparecem: ficam em <b>Detetados recentemente</b>, com retorno e pico desde a primeira deteção. DexScreener faz a descoberta precoce e CoinGecko é verificada depois por contrato.</p>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center shrink-0">
          <div className="rounded-lg bg-[var(--surface-2)] px-3 py-2"><div className="font-data font-bold text-[var(--accent-risk)]">{count("explosive")}</div><div className="text-[9px] text-[var(--text-faint)]">EXPLOSIVE</div></div>
          <div className="rounded-lg bg-[var(--surface-2)] px-3 py-2"><div className="font-data font-bold text-[var(--accent-gold)]">{count("breakout")}</div><div className="text-[9px] text-[var(--text-faint)]">BREAKOUT</div></div>
          <div className="rounded-lg bg-[var(--surface-2)] px-3 py-2"><div className="font-data font-bold text-[var(--accent-info)]">{count("emerging")}</div><div className="text-[9px] text-[var(--text-faint)]">EMERGING</div></div>
          <div className="rounded-lg bg-[var(--surface-2)] px-3 py-2"><div className="font-data font-bold text-[var(--accent-opportunity)]">{count("mature")}</div><div className="text-[9px] text-[var(--text-faint)]">DEX MATURE</div></div>
        </div>
      </div>
    </div>

    {feed && <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><div className="font-display text-sm font-semibold">📊 CoinGecko Listing Effect</div><div className="text-[10px] text-[var(--text-faint)]">Só mede transições que a MemeScope viu primeiro como DEX-only e depois confirmou na CoinGecko.</div></div>
        <span className="text-[10px] text-[var(--text-muted)]">Transições observadas: <b className="font-data text-[var(--text)]">{feed.listingEffect.observedTransitions}</b></span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2"><Horizon label="Mediana +15m" stats={feed.listingEffect.return15m} /><Horizon label="Mediana +1h" stats={feed.listingEffect.return1h} /><Horizon label="Mediana +6h" stats={feed.listingEffect.return6h} /><Horizon label="Mediana +24h" stats={feed.listingEffect.return24h} /></div>
      <div className="text-[9px] text-[var(--text-faint)]">Estas métricas começam em N/D e tornam-se úteis apenas depois de acumular uma amostra real. Não tratamos “entrar na CoinGecko” como garantia de subida.</div>
    </div>}

    <div className="flex items-center justify-between gap-2">
      <div>
        <h3 className="font-display text-sm font-semibold">🔥 Live Radar</h3>
        <p className="text-[10px] text-[var(--text-faint)]">Passam os filtros neste momento. Estes são os candidatos ativos, não o histórico.</p>
      </div>
      <span className="font-data text-xs text-[var(--text-muted)]">{feed?.candidates.length ?? 0} live</span>
    </div>

    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 flex flex-wrap gap-2 text-xs">
      <button onClick={() => setSourceFilter("all")} className={`rounded-lg border px-3 py-1.5 ${sourceFilter === "all" ? "border-[var(--accent-info)] text-[var(--accent-info)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>Todas as fontes</button>
      <button onClick={() => setSourceFilter("dexscreener")} className={`rounded-lg border px-3 py-1.5 ${sourceFilter === "dexscreener" ? "border-[var(--accent-info)] text-[var(--accent-info)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>Source: DexScreener ({sourceCount("dexscreener")})</button>
      <button onClick={() => setSourceFilter("coingecko")} className={`rounded-lg border px-3 py-1.5 ${sourceFilter === "coingecko" ? "border-[var(--accent-opportunity)] text-[var(--accent-opportunity)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>Source: CoinGecko ({sourceCount("coingecko")})</button>
      <button onClick={() => setSourceFilter("pre_coingecko")} className={`rounded-lg border px-3 py-1.5 ${sourceFilter === "pre_coingecko" ? "border-[var(--accent-gold)] text-[var(--accent-gold)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>🔎 Pre-CoinGecko ({preCgCount})</button>
    </div>

    <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-1">{(["all", "explosive", "breakout", "emerging", "mature"] as RadarFilter[]).map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-lg border px-3 py-1.5 text-xs ${filter === f ? "border-[var(--accent-info)] text-[var(--accent-info)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>{f === "all" ? "Todos" : META[f].label}</button>)}</div>
      <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-muted)]"><option value="score">Maior Early Momentum</option><option value="newest">Mais novo</option><option value="momentum">Maior subida 5m</option><option value="liquidity">Maior liquidez</option></select>
    </div>

    {loading && <div className="text-sm text-[var(--text-muted)]">A procurar novos pares e a verificar CoinGecko…</div>}
    {!loading && feed?.error && !feed.candidates.length && <div className="rounded-xl border border-[var(--accent-risk)]/30 bg-[var(--surface)] p-4 text-sm text-[var(--accent-risk)]">O feed de novos tokens está temporariamente indisponível.</div>}
    {!loading && feed && !candidates.length && <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--text-muted)]"><div className="font-semibold text-[var(--text)]">Nenhum candidato passou estes filtros neste momento.</div><p className="mt-1 text-xs">O radar prefere mostrar zero tokens a promover pools sem liquidez, volume ou atividade suficientes.</p></div>}
    {!!candidates.length && <div className="grid lg:grid-cols-2 gap-4">{candidates.map((c) => <Card key={c.tokenKey} c={c} />)}</div>}

    {feed && <div className="border-t border-[var(--border)] pt-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-semibold">🕘 Detetados recentemente</h3>
          <p className="text-[10px] text-[var(--text-faint)]">Tokens vistos nas últimas 48h que já não estão no Live Radar. Permanecem aqui para medir o que aconteceu depois da deteção.</p>
        </div>
        <span className="font-data text-xs text-[var(--text-muted)]">{recentCandidates.length} guardados</span>
      </div>
      {!recentCandidates.length ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--text-muted)]">Ainda não há candidatos que tenham saído do Live Radar nesta janela.</div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">{recentCandidates.map((c) => <Card key={`recent-${c.tokenKey}`} c={c} />)}</div>
      )}
    </div>}

    {feed && <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[10px] text-[var(--text-faint)]">Analisados nesta atualização: {feed.scannedTokens} · rejeitados pelos filtros: {feed.rejectedTokens}. {feed.note} “Source: CoinGecko” significa que o contrato foi confirmado na CoinGecko; não significa que a CoinGecko seja a origem da descoberta. “Primeira confirmação” é a data observada pela MemeScope, não uma data oficial de listing. *FDV é mostrado quando market cap não está disponível.</div>}
  </section>;
}
