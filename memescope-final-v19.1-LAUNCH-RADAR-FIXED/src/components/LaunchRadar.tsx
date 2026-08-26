"use client";

import { useEffect, useMemo, useState } from "react";
import type { RadarCandidate, RadarFeed } from "@/lib/newTokenRadar";
import { formatUsd, formatPercent } from "@/lib/format";

function age(c: RadarCandidate) {
  const sec = Math.max(0, Math.round(c.ageMinutes * 60));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}
function buyRatio(c: RadarCandidate) {
  const total = (c.buysM5 ?? 0) + (c.sellsM5 ?? 0);
  return total ? ((c.buysM5 ?? 0) / total) * 100 : null;
}
function launchVelocity(c: RadarCandidate) {
  const ageMin = Math.max(c.ageMinutes, 0.25);
  const tx = (c.buysM5 ?? 0) + (c.sellsM5 ?? 0);
  const txPerMin = tx / Math.min(ageMin, 5);
  const volPerMin = (c.volumeM5 ?? 0) / Math.min(ageMin, 5);
  const br = buyRatio(c) ?? 50;
  const liquidity = c.liquidityUsd ?? 0;
  const price = c.priceChangeM5 ?? 0;
  let score = 0;
  score += Math.min(28, txPerMin / 2.5);
  score += Math.min(28, volPerMin / 180);
  score += Math.max(0, Math.min(18, (br - 45) * 0.65));
  score += Math.min(14, liquidity / 2500);
  score += Math.max(0, Math.min(12, price / 2));
  if (price > 120) score -= 15; // already very stretched
  if (c.activityInflationRisk === "critical") score -= 30;
  if (c.securityAssessment?.critical) score -= 50;
  return Math.max(0, Math.min(100, Math.round(score)));
}
function bucket(c: RadarCandidate) {
  if (c.ageMinutes < 1) return "JUST LISTED";
  if (c.ageMinutes < 2) return "< 2 MIN";
  return "2–5 MIN";
}
function tone(v: number) {
  return v >= 75 ? "text-[var(--accent-opportunity)]" : v >= 55 ? "text-[var(--accent-gold)]" : "text-[var(--text-muted)]";
}

function LaunchCard({ c }: { c: RadarCandidate }) {
  const velocity = launchVelocity(c);
  const br = buyRatio(c);
  const tx = (c.buysM5 ?? 0) + (c.sellsM5 ?? 0);
  const [tracked, setTracked] = useState(false);
  const markBought = async () => {
    const res = await fetch("/api/trading-lab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "open_manual", candidate: c, notionalUsd: 10 }) });
    if (res.ok) setTracked(true);
  };
  const security = c.securityAssessment;
  const danger = security?.critical || c.activityInflationRisk === "critical";
  return <article className={`rounded-xl border bg-[var(--surface)] p-4 space-y-3 ${danger ? "border-[var(--accent-risk)]/60" : "border-[var(--border)]"}`}>
    <div className="flex justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-[var(--accent-info)]/40 px-2 py-0.5 text-[10px] text-[var(--accent-info)]">🐣 {bucket(c)}</span><b className="truncate">{c.name}</b><span className="text-xs text-[var(--text-muted)]">${c.symbol}</span></div>
        <div className="mt-1 text-[11px] text-[var(--text-faint)]">Listado hace <b className="text-[var(--text)]">{age(c)}</b> · detectado hace {Math.max(0, Math.round(c.detectedMinutesAgo * 60))}s</div>
      </div>
      <div className="text-right shrink-0"><div className={`font-data text-2xl font-bold ${tone(velocity)}`}>{velocity}</div><div className="text-[9px] text-[var(--text-faint)]">LAUNCH VELOCITY</div></div>
    </div>

    {danger && <div className="rounded-lg border border-[var(--accent-risk)]/40 bg-[var(--accent-risk-dim)]/30 p-2 text-xs text-[var(--accent-risk)]">⛔ Riesgo crítico detectado. No se trata como candidato de entrada.</div>}

    <div className="grid grid-cols-3 gap-2 text-xs">
      <div className="rounded-lg bg-[var(--surface-2)] p-2"><span className="text-[var(--text-faint)]">Precio 5m</span><div className="font-data font-semibold">{formatPercent(c.priceChangeM5)}</div></div>
      <div className="rounded-lg bg-[var(--surface-2)] p-2"><span className="text-[var(--text-faint)]">Compras</span><div className="font-data font-semibold">{br === null ? "N/D" : `${br.toFixed(0)}%`}</div></div>
      <div className="rounded-lg bg-[var(--surface-2)] p-2"><span className="text-[var(--text-faint)]">Trades</span><div className="font-data font-semibold">{tx}</div></div>
      <div className="rounded-lg bg-[var(--surface-2)] p-2"><span className="text-[var(--text-faint)]">Volumen</span><div className="font-data font-semibold">{formatUsd(c.volumeM5, { compact: true })}</div></div>
      <div className="rounded-lg bg-[var(--surface-2)] p-2"><span className="text-[var(--text-faint)]">Liquidez</span><div className="font-data font-semibold">{formatUsd(c.liquidityUsd, { compact: true })}</div></div>
      <div className="rounded-lg bg-[var(--surface-2)] p-2"><span className="text-[var(--text-faint)]">Seguridad</span><div className="font-data font-semibold">{security?.score ?? "N/D"}{security?.score != null ? "/100" : ""}</div></div>
    </div>

    <div className="text-[10px] text-[var(--text-muted)]">Buys/Sells: <b>{c.buysM5 ?? 0}/{c.sellsM5 ?? 0}</b> · Activity: <b>{c.transactionQualityScore?.toFixed(0) ?? "N/D"}</b>{(c.priceChangeM5 ?? 0) > 100 ? <span className="text-[var(--accent-risk)]"> · ⚠️ ya está muy estirada</span> : null}</div>

    <div className="flex flex-wrap gap-2">
      <button onClick={markBought} disabled={tracked || danger} className="rounded-lg border border-[var(--accent-opportunity)]/40 px-3 py-1.5 text-xs text-[var(--accent-opportunity)] disabled:opacity-40">{tracked ? "✓ Monitorizando" : "💰 Marqué compra"}</button>
      <a href={c.dexUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--accent-info)]">DexScreener ↗</a>
      {c.chain === "solana" && <a href={`https://solscan.io/token/${c.address}`} target="_blank" rel="noreferrer" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]">Solscan ↗</a>}
    </div>
  </article>;
}

export default function LaunchRadar() {
  const [feed, setFeed] = useState<RadarFeed | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let stop = false;
    const load = () => fetch("/api/radar", { cache: "no-store" }).then(r => r.json()).then(j => { if (!stop) setFeed(j); }).finally(() => { if (!stop) setLoading(false); });
    load();
    const id = window.setInterval(load, 15_000);
    return () => { stop = true; clearInterval(id); };
  }, []);
  const launch = useMemo(() => [...(feed?.candidates ?? []), ...(feed?.recentCandidates ?? [])]
    .filter((c, i, arr) => c.chain === "solana" && c.ageMinutes <= 5 && arr.findIndex(x => x.tokenKey === c.tokenKey) === i)
    .sort((a,b) => a.ageMinutes - b.ageMinutes || launchVelocity(b) - launchVelocity(a)), [feed]);
  const groups = [["🐣 JUST LISTED · <1 MIN", launch.filter(c => c.ageMinutes < 1)], ["⚡ 1–2 MIN", launch.filter(c => c.ageMinutes >= 1 && c.ageMinutes < 2)], ["🔥 2–5 MIN", launch.filter(c => c.ageMinutes >= 2)]] as const;
  return <section className="space-y-5">
    <div className="rounded-2xl border border-[var(--accent-info)]/35 bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">⚡ Launch Radar</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Solo Solana · primeros 5 minutos. Aquí no esperamos a que el momentum esté “confirmado”. Buscamos aceleración antes del pico.</p></div><div className="font-data text-sm"><b>{launch.length}</b> &lt;5m</div></div>
      <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-2 text-[10px] text-[var(--text-muted)]">Actualiza cada 15s. Launch Velocity es experimental: prioriza trades/min, volumen/min, presión compradora y liquidez. Security sigue actuando como freno, no como señal de compra.</div>
    </div>
    {loading && !feed ? <div className="text-sm text-[var(--text-muted)]">Buscando lanzamientos…</div> : groups.map(([title, list]) => <div key={title} className="space-y-2"><div className="flex justify-between"><h3 className="font-display text-sm font-semibold">{title}</h3><span className="text-xs text-[var(--text-muted)]">{list.length}</span></div>{list.length ? <div className="grid lg:grid-cols-2 gap-3">{list.map(c => <LaunchCard key={c.tokenKey} c={c} />)}</div> : <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-[var(--text-muted)]">Nada nuevo en esta ventana ahora mismo. Esto es normal; no rellenamos la pantalla con monedas viejas.</div>}</div>)}
    <div className="text-[10px] text-[var(--text-faint)]">Importante: DexScreener no ofrece en su API pública un stream garantizado de absolutamente todos los pares nuevos. MemeScope muestra los lanzamientos que descubre mediante sus feeds públicos; por eso puede haber lanzamientos que no aparezcan.</div>
  </section>;
}
