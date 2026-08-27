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
function launchStage(c: RadarCandidate, velocity: number) {
  if (c.securityAssessment?.critical || c.activityInflationRisk === "critical") return { label: "🔴 DANGER", cls: "text-[var(--accent-risk)] border-[var(--accent-risk)]/45" };
  if (velocity >= 75) return { label: "🔥 LAUNCHING", cls: "text-[var(--accent-opportunity)] border-[var(--accent-opportunity)]/45" };
  if (velocity >= 55) return { label: "🟢 ACCELERATING", cls: "text-[var(--accent-opportunity)] border-[var(--accent-opportunity)]/35" };
  if (((c.buysM5 ?? 0) + (c.sellsM5 ?? 0)) > 0 || (c.volumeM5 ?? 0) > 0) return { label: "🟡 WARMING UP", cls: "text-[var(--accent-gold)] border-[var(--accent-gold)]/35" };
  return { label: "⚪ NEW", cls: "text-[var(--text-muted)] border-[var(--border)]" };
}

function LaunchCard({ c }: { c: RadarCandidate }) {
  const velocity = launchVelocity(c);
  const stage = launchStage(c, velocity);
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
        <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-[var(--accent-info)]/40 px-2 py-0.5 text-[10px] text-[var(--accent-info)]">🐣 {bucket(c)}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${stage.cls}`}>{stage.label}</span><b className="truncate">{c.name}</b><span className="text-xs text-[var(--text-muted)]">${c.symbol}</span></div>
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


type InstantLaunch = {
  mint: string;
  name: string;
  symbol: string;
  createdAt: number;
  solAmount: number | null;
  marketCapSol: number | null;
};

function InstantCard({ token, now }: { token: InstantLaunch; now: number }) {
  const seconds = Math.max(0, Math.floor((now - token.createdAt) / 1000));
  const ageText = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return <article className="rounded-xl border border-[var(--accent-opportunity)]/40 bg-[var(--surface)] p-4 space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--accent-opportunity)]/45 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-opportunity)]">⚡ LIVE CREATE</span>
          <b className="truncate">{token.name || "Nuevo token"}</b>
          <span className="text-xs text-[var(--text-muted)]">${token.symbol || "?"}</span>
        </div>
        <div className="mt-1 text-[11px] text-[var(--text-faint)]">Creado hace <b className="text-[var(--text)]">{ageText}</b> · detectado sin esperar a DexScreener</div>
      </div>
      <div className="font-data text-lg font-bold text-[var(--accent-opportunity)]">{seconds < 60 ? "NEW" : "<5m"}</div>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
      <div className="rounded-lg bg-[var(--surface-2)] p-2"><span className="text-[var(--text-faint)]">Initial buy</span><div className="font-data font-semibold">{token.solAmount == null ? "N/D" : `${token.solAmount.toFixed(3)} SOL`}</div></div>
      <div className="rounded-lg bg-[var(--surface-2)] p-2"><span className="text-[var(--text-faint)]">Market cap</span><div className="font-data font-semibold">{token.marketCapSol == null ? "N/D" : `${token.marketCapSol.toFixed(1)} SOL`}</div></div>
      <div className="rounded-lg bg-[var(--surface-2)] p-2"><span className="text-[var(--text-faint)]">DEX data</span><div className="font-semibold text-[var(--accent-gold)]">esperando…</div></div>
    </div>
    <div className="rounded-lg bg-[var(--surface-2)] p-2 text-[10px] text-[var(--text-muted)]">Recién creado ≠ buena compra. Todavía puede no haber datos suficientes de liquidez, ventas o seguridad.</div>
    <div className="flex flex-wrap gap-2">
      <a href={`https://pump.fun/coin/${token.mint}`} target="_blank" rel="noreferrer" className="rounded-lg border border-[var(--accent-opportunity)]/40 px-3 py-1.5 text-xs text-[var(--accent-opportunity)]">Pump.fun ↗</a>
      <a href={`https://jup.ag/swap/SOL-${token.mint}`} target="_blank" rel="noreferrer" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--accent-info)]">Jupiter ↗</a>
      <a href={`https://solscan.io/token/${token.mint}`} target="_blank" rel="noreferrer" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]">Solscan ↗</a>
    </div>
  </article>;
}

export default function LaunchRadar() {
  const [feed, setFeed] = useState<RadarFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [instant, setInstant] = useState<InstantLaunch[]>([]);
  const [streamState, setStreamState] = useState<"connecting" | "live" | "offline">("connecting");
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      setInstant((items) => items.filter((x) => now - x.createdAt <= 5 * 60_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnect: number | null = null;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      setStreamState("connecting");
      try {
        ws = new WebSocket("wss://pumpdev.io/ws");
        ws.onopen = () => {
          setStreamState("live");
          ws?.send(JSON.stringify({ method: "subscribeNewToken" }));
        };
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data));
            const mint = typeof msg?.mint === "string" ? msg.mint : "";
            if (!mint || msg?.txType !== "create") return;
            const token: InstantLaunch = {
              mint,
              name: typeof msg?.name === "string" ? msg.name : "Nuevo token",
              symbol: typeof msg?.symbol === "string" ? msg.symbol : "?",
              createdAt: Date.now(),
              solAmount: typeof msg?.solAmount === "number" ? msg.solAmount : (typeof msg?.quoteAmount === "number" ? msg.quoteAmount : null),
              marketCapSol: typeof msg?.marketCapSol === "number" ? msg.marketCapSol : null,
            };
            setInstant((items) => [token, ...items.filter((x) => x.mint !== mint)].slice(0, 80));
          } catch {}
        };
        ws.onerror = () => setStreamState("offline");
        ws.onclose = () => {
          setStreamState("offline");
          if (!stopped) reconnect = window.setTimeout(connect, 3_000);
        };
      } catch {
        setStreamState("offline");
        reconnect = window.setTimeout(connect, 3_000);
      }
    };
    connect();
    return () => {
      stopped = true;
      if (reconnect !== null) window.clearTimeout(reconnect);
      ws?.close();
    };
  }, []);

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
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">⚡ Launch Radar</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Solo Solana · primeros 5 minutos. Ya no escondemos un lanzamiento por tener poco volumen o liquidez: primero lo ves, después decides si está despertando.</p></div><div className="text-right text-xs text-[var(--text-muted)]"><div className="font-data text-sm"><b>{launch.length}</b> pares &lt;5m</div><div>escaneados: <b>{feed?.scannedTokens ?? 0}</b></div></div></div>
      <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-2 text-[10px] text-[var(--text-muted)]">⚪ NEW → 🟡 WARMING UP → 🟢 ACCELERATING → 🔥 LAUNCHING. Launch Velocity ordena y describe; ya no elimina tokens recién nacidos. Riesgos críticos se marcan como 🔴 DANGER.</div>
    </div>
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-display text-sm font-semibold">⚡ DIRECT LAUNCH STREAM · 0–5 MIN</h3><p className="text-[10px] text-[var(--text-faint)]">Aparecen al crearse; no esperamos a DexScreener.</p></div>
        <div className="text-xs text-[var(--text-muted)]">Stream: <b className={streamState === "live" ? "text-[var(--accent-opportunity)]" : streamState === "offline" ? "text-[var(--accent-risk)]" : "text-[var(--accent-gold)]"}>{streamState === "live" ? "LIVE" : streamState === "offline" ? "OFFLINE" : "CONECTANDO"}</b> · <b>{instant.length}</b> lanzamientos</div>
      </div>
      {instant.length ? <div className="grid lg:grid-cols-2 gap-3">{instant.map((token) => <InstantCard key={token.mint} token={token} now={clock} />)}</div> : <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-[var(--text-muted)]">{streamState === "live" ? "Stream conectado. Esperando el próximo token de Pump.fun…" : "Conectando al stream directo de nuevos tokens…"}</div>}
    </div>
    <div className="border-t border-[var(--border)] pt-4"><div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">DexScreener enrichment · cuando el par ya está indexado</div></div>
    {loading && !feed ? <div className="text-sm text-[var(--text-muted)]">Buscando lanzamientos…</div> : groups.map(([title, list]) => <div key={title} className="space-y-2"><div className="flex justify-between"><h3 className="font-display text-sm font-semibold">{title}</h3><span className="text-xs text-[var(--text-muted)]">{list.length}</span></div>{list.length ? <div className="grid lg:grid-cols-2 gap-3">{list.map(c => <LaunchCard key={c.tokenKey} c={c} />)}</div> : <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-[var(--text-muted)]">No hay ningún par confirmado por DexScreener en esta franja de edad ahora mismo. No es un filtro de volumen/liquidez: si existe un par ≤5m que nuestros feeds descubren, debería aparecer aquí.</div>}</div>)}
    <div className="text-[10px] text-[var(--text-faint)]">Discovery V19.3: DIRECT LAUNCH STREAM recibe creaciones en tiempo real sin esperar a DexScreener. El bloque inferior usa DexScreener para añadir precio, trades, volumen, liquidez y Security cuando esos datos estén indexados.</div>
  </section>;
}
