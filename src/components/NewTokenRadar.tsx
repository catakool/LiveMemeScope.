"use client";

import { useEffect, useMemo, useState } from "react";
import type { RadarCandidate, RadarFeed, RadarClassification } from "@/lib/newTokenRadar";
import { formatUsd, formatPercent } from "@/lib/format";
import { CHAIN_LABEL } from "@/lib/tiers";

type RadarFilter = "all" | RadarClassification;
type SortMode = "score" | "newest" | "momentum" | "liquidity";

const META: Record<RadarClassification, { label: string; icon: string; cls: string }> = {
  explosive: { label: "Explosive", icon: "🚨", cls: "text-[var(--accent-risk)] border-[var(--accent-risk)]/50" },
  breakout: { label: "Breakout", icon: "🔥", cls: "text-[var(--accent-gold)] border-[var(--accent-gold)]/50" },
  emerging: { label: "Emerging", icon: "👀", cls: "text-[var(--accent-info)] border-[var(--accent-info)]/50" },
};

function ageLabel(minutes: number) {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(minutes < 180 ? 1 : 0)} h`;
  return `${(minutes / 1440).toFixed(1)} d`;
}
function changeCls(v: number | null) {
  return v === null ? "text-[var(--text-muted)]" : v >= 0 ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-risk)]";
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
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.icon} {m.label}</span>
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-faint)]">
            {CHAIN_LABEL[c.chain]} · par criado há {ageLabel(c.ageMinutes)} · MemeScope detetou há {ageLabel(c.detectedMinutesAgo)}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-data text-xl font-bold">{c.earlyMomentumScore.toFixed(0)}</div>
          <div className="text-[9px] uppercase tracking-wider text-[var(--text-faint)]">Early Momentum</div>
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
        <span>Fonte: <b className="text-[var(--text)]">{c.source === "latest_profile" ? "perfil recente" : c.source === "boosted" ? "boosted" : "perfil + boosted"}</b></span>
      </div>

      {!!c.reasons.length && <div><div className="text-[10px] uppercase tracking-wider text-[var(--accent-opportunity)] mb-1">Por que apareceu?</div><ul className="space-y-1 text-[11px] text-[var(--text-muted)]">{c.reasons.slice(0, 4).map((r) => <li key={r}>• {r}</li>)}</ul></div>}
      {!!c.risks.length && <div className="rounded-lg border border-[var(--accent-risk)]/25 bg-[var(--accent-risk-dim)]/30 p-2"><div className="text-[10px] uppercase tracking-wider text-[var(--accent-risk)] mb-1">Risco extremo</div><div className="text-[10px] text-[var(--text-muted)]">{c.risks.slice(0, 3).join(" · ")}</div></div>}

      <div className="flex items-center justify-between gap-2 pt-1">
        <code className="text-[9px] text-[var(--text-faint)] truncate max-w-[65%]" title={c.address}>{c.address}</code>
        <a href={c.dexUrl} target="_blank" rel="noreferrer" className="text-xs rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[var(--accent-info)] hover:border-[var(--accent-info)]/60">Ver na DexScreener ↗</a>
      </div>
    </article>
  );
}

export default function NewTokenRadar() {
  const [feed, setFeed] = useState<RadarFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RadarFilter>("all");
  const [sort, setSort] = useState<SortMode>("score");

  useEffect(() => {
    let cancelled = false;
    const load = () => fetch("/api/radar", { cache: "no-store" }).then((r) => r.json()).then((j: RadarFeed) => { if (!cancelled) setFeed(j); }).catch(() => { if (!cancelled) setFeed(null); }).finally(() => { if (!cancelled) setLoading(false); });
    load(); const timer = window.setInterval(load, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const candidates = useMemo(() => {
    const list = [...(feed?.candidates ?? [])].filter((c) => filter === "all" || c.classification === filter);
    if (sort === "newest") list.sort((a,b)=>a.ageMinutes-b.ageMinutes);
    else if (sort === "momentum") list.sort((a,b)=>(b.priceChangeM5 ?? -Infinity)-(a.priceChangeM5 ?? -Infinity));
    else if (sort === "liquidity") list.sort((a,b)=>(b.liquidityUsd ?? 0)-(a.liquidityUsd ?? 0));
    else list.sort((a,b)=>b.earlyMomentumScore-a.earlyMomentumScore);
    return list;
  }, [feed, filter, sort]);
  const count = (c: RadarClassification) => feed?.candidates.filter((x)=>x.classification===c).length ?? 0;

  return <section className="space-y-5">
    <div className="rounded-2xl border border-[var(--accent-info)]/30 bg-[var(--surface)] p-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div><div className="flex items-center gap-2"><span className="text-xl">🚀</span><h2 className="font-display text-lg font-semibold">New Token Radar</h2><span className={`rounded-full border px-2 py-0.5 text-[10px] ${feed?.status === "live" ? "border-[var(--accent-opportunity)]/40 text-[var(--accent-opportunity)]" : "border-[var(--accent-risk)]/40 text-[var(--accent-risk)]"}`}>{feed?.status === "live" ? "LIVE" : "INDISPONÍVEL"}</span></div>
          <p className="mt-2 max-w-3xl text-xs text-[var(--text-muted)]">Procura pares muito recentes que já mostram atividade real: momentum 5m, volume, liquidez e compras/vendas. Pools sem liquidez/atividade mínima são rejeitados antes de chegar ao ecrã.</p></div>
        <div className="grid grid-cols-3 gap-2 text-center shrink-0"><div className="rounded-lg bg-[var(--surface-2)] px-3 py-2"><div className="font-data font-bold text-[var(--accent-risk)]">{count("explosive")}</div><div className="text-[9px] text-[var(--text-faint)]">EXPLOSIVE</div></div><div className="rounded-lg bg-[var(--surface-2)] px-3 py-2"><div className="font-data font-bold text-[var(--accent-gold)]">{count("breakout")}</div><div className="text-[9px] text-[var(--text-faint)]">BREAKOUT</div></div><div className="rounded-lg bg-[var(--surface-2)] px-3 py-2"><div className="font-data font-bold text-[var(--accent-info)]">{count("emerging")}</div><div className="text-[9px] text-[var(--text-faint)]">EMERGING</div></div></div>
      </div>
    </div>

    <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between"><div className="flex flex-wrap gap-1">{(["all","explosive","breakout","emerging"] as RadarFilter[]).map((f)=><button key={f} onClick={()=>setFilter(f)} className={`rounded-lg border px-3 py-1.5 text-xs ${filter===f ? "border-[var(--accent-info)] text-[var(--accent-info)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>{f === "all" ? "Todos" : META[f].label}</button>)}</div>
      <select value={sort} onChange={(e)=>setSort(e.target.value as SortMode)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-muted)]"><option value="score">Maior Early Momentum</option><option value="newest">Mais novo</option><option value="momentum">Maior subida 5m</option><option value="liquidity">Maior liquidez</option></select></div>

    {loading && <div className="text-sm text-[var(--text-muted)]">A procurar novos pares com atividade anormal…</div>}
    {!loading && feed?.error && !feed.candidates.length && <div className="rounded-xl border border-[var(--accent-risk)]/30 bg-[var(--surface)] p-4 text-sm text-[var(--accent-risk)]">O feed de novos tokens está temporariamente indisponível.</div>}
    {!loading && feed && !candidates.length && <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--text-muted)]"><div className="font-semibold text-[var(--text)]">Nenhum candidato passou os filtros neste momento.</div><p className="mt-1 text-xs">Isto é intencional: o radar prefere mostrar zero tokens a promover pools sem liquidez, volume ou transações suficientes.</p></div>}
    {!!candidates.length && <div className="grid lg:grid-cols-2 gap-4">{candidates.map((c)=><Card key={c.tokenKey} c={c} />)}</div>}
    {feed && <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[10px] text-[var(--text-faint)]">Analisados nesta atualização: {feed.scannedTokens} · rejeitados pelos filtros: {feed.rejectedTokens}. {feed.note} “Early Momentum” não é probabilidade de lucro nem recomendação automática de compra. Tokens novos podem perder 100% do valor. *FDV é mostrado quando market cap não está disponível.</div>}
  </section>;
}
