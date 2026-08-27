"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type SniperTick = { t: number; marketCapSol: number; side: "buy" | "sell" | "other" };
type SniperExitReason = "hard_stop" | "reversal" | "sell_pressure" | "no_momentum" | "time_exit" | "manual";
type PaperSniperPosition = {
  mint: string;
  name: string;
  symbol: string;
  openedAt: number;
  closedAt: number | null;
  status: "open" | "closed";
  entryMarketCapSol: number;
  currentMarketCapSol: number;
  peakMarketCapSol: number;
  troughMarketCapSol: number;
  grossReturnPct: number;
  netReturnPct: number;
  peakReturnPct: number;
  drawdownFromPeakPct: number;
  exitReason: SniperExitReason | null;
  tradeCount: number;
  buys: number;
  sells: number;
  ticks: SniperTick[];
};

const SNIPER_NOTIONAL_USD = 10;
const SNIPER_FRICTION_PCT = 3; // conservative paper estimate; NOT actual execution slippage
const SNIPER_MAX_OPEN = 5; // anonymous PumpDev token-trade subscription pool
const SNIPER_STORAGE_KEY = "memescope:paper-sniper:v20";

function ret(entry: number, current: number) {
  return entry > 0 ? ((current / entry) - 1) * 100 : 0;
}
function sniperExitLabel(reason: SniperExitReason | null) {
  const labels: Record<SniperExitReason, string> = {
    hard_stop: "HARD STOP", reversal: "REVERSAL", sell_pressure: "SELL PRESSURE",
    no_momentum: "NO MOMENTUM", time_exit: "TIME EXIT", manual: "MANUAL",
  };
  return reason ? labels[reason] : "OPEN";
}
function pctText(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`; }

function InstantCard({ token, now, paperOpen }: { token: InstantLaunch; now: number; paperOpen: boolean }) {
  const [copied, setCopied] = useState(false);
  const copyMint = async () => {
    await navigator.clipboard.writeText(token.mint);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  const seconds = Math.max(0, Math.floor((now - token.createdAt) / 1000));
  const ageText = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return <article className="rounded-xl border border-[var(--accent-opportunity)]/40 bg-[var(--surface)] p-4 space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--accent-opportunity)]/45 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-opportunity)]">⚡ LIVE CREATE</span>{paperOpen && <span className="rounded-full border border-[var(--accent-info)]/45 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-info)]">🤖 PAPER IN</span>}
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
      <button onClick={copyMint} className="rounded-lg border border-[var(--accent-gold)]/40 px-3 py-1.5 text-xs text-[var(--accent-gold)]">{copied ? "✓ COPIED" : "📋 COPY MINT"}</button>
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
  const [autoPaper, setAutoPaper] = useState(true);
  const [sniperPositions, setSniperPositions] = useState<PaperSniperPosition[]>([]);
  const positionsRef = useRef<PaperSniperPosition[]>([]);
  const autoPaperRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SNIPER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PaperSniperPosition[];
        // Previous browser sessions cannot be monitored continuously, so any stale open
        // position is closed locally instead of pretending we observed its exit.
        const now = Date.now();
        const safe = parsed.map((p) => p.status === "open" && now - p.openedAt > 2 * 60_000
          ? { ...p, status: "closed" as const, closedAt: now, exitReason: "time_exit" as const }
          : p).slice(0, 120);
        positionsRef.current = safe;
        setSniperPositions(safe);
      }
    } catch {}
  }, []);

  useEffect(() => { autoPaperRef.current = autoPaper; }, [autoPaper]);

  useEffect(() => {
    positionsRef.current = sniperPositions;
    try { window.localStorage.setItem(SNIPER_STORAGE_KEY, JSON.stringify(sniperPositions.slice(0, 120))); } catch {}
  }, [sniperPositions]);

  const closePaper = (mint: string, reason: SniperExitReason, atMarketCap?: number) => {
    const now = Date.now();
    let closed = false;
    const next = positionsRef.current.map((p) => {
      if (p.mint !== mint || p.status !== "open") return p;
      const current = atMarketCap && atMarketCap > 0 ? atMarketCap : p.currentMarketCapSol;
      const gross = ret(p.entryMarketCapSol, current);
      closed = true;
      return { ...p, status: "closed" as const, closedAt: now, currentMarketCapSol: current, grossReturnPct: gross, netReturnPct: gross - SNIPER_FRICTION_PCT, exitReason: reason };
    });
    if (!closed) return;
    positionsRef.current = next;
    setSniperPositions(next);
    try { wsRef.current?.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [mint] })); } catch {}
  };

  const evaluatePaperTick = (position: PaperSniperPosition, marketCapSol: number, side: SniperTick["side"], now: number) => {
    const gross = ret(position.entryMarketCapSol, marketCapSol);
    const peak = Math.max(position.peakMarketCapSol, marketCapSol);
    const peakReturn = ret(position.entryMarketCapSol, peak);
    const drawdown = ret(peak, marketCapSol);
    const ticks = [...position.ticks, { t: now, marketCapSol, side }].slice(-12);
    const recent = ticks.filter((x) => now - x.t <= 4_000);
    const sellCount = recent.filter((x) => x.side === "sell").length;
    const buyCount = recent.filter((x) => x.side === "buy").length;
    const ageMs = now - position.openedAt;

    let reason: SniperExitReason | null = null;
    if (gross <= -12) reason = "hard_stop";
    else if (ageMs >= 2_000 && peakReturn >= 8) {
      // Dynamic trailing: react faster once the token has already made a sharp move.
      const trail = peakReturn >= 100 ? -12 : peakReturn >= 50 ? -10 : peakReturn >= 20 ? -8 : -6;
      const sellPressure = sellCount >= 2 && sellCount > buyCount;
      const rapidDrop = recent.length >= 2 && ret(recent[0].marketCapSol, marketCapSol) <= -8;
      if (drawdown <= trail && (sellPressure || rapidDrop || peakReturn >= 50)) reason = "reversal";
    }
    if (!reason && ageMs >= 4_000 && gross > 3 && sellCount >= 3 && sellCount >= buyCount * 2) reason = "sell_pressure";
    if (!reason && ageMs >= 30_000 && peakReturn < 5 && gross <= 0) reason = "no_momentum";
    if (!reason && ageMs >= 90_000) reason = "time_exit";

    const updated: PaperSniperPosition = {
      ...position, currentMarketCapSol: marketCapSol, peakMarketCapSol: peak,
      troughMarketCapSol: Math.min(position.troughMarketCapSol, marketCapSol),
      grossReturnPct: gross, netReturnPct: gross - SNIPER_FRICTION_PCT, peakReturnPct: peakReturn,
      drawdownFromPeakPct: drawdown, tradeCount: position.tradeCount + 1,
      buys: position.buys + (side === "buy" ? 1 : 0), sells: position.sells + (side === "sell" ? 1 : 0), ticks,
    };
    return { updated, reason };
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      setInstant((items) => items.filter((x) => now - x.createdAt <= 5 * 60_000));
      for (const p of positionsRef.current) {
        if (p.status === "open" && now - p.openedAt >= 90_000) closePaper(p.mint, "time_exit");
      }
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
        wsRef.current = ws;
        ws.onopen = () => {
          setStreamState("live");
          ws?.send(JSON.stringify({ method: "subscribeNewToken" }));
          const openMints = positionsRef.current.filter((p) => p.status === "open").slice(0, SNIPER_MAX_OPEN).map((p) => p.mint);
          if (openMints.length) ws?.send(JSON.stringify({ method: "subscribeTokenTrade", keys: openMints }));
        };
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data));
            const mint = typeof msg?.mint === "string" ? msg.mint : "";
            if (!mint) return;

            if (msg?.txType === "create") {
              const mc = typeof msg?.marketCapSol === "number" ? msg.marketCapSol : (typeof msg?.marketCapQuote === "number" ? msg.marketCapQuote : null);
              const token: InstantLaunch = {
                mint,
                name: typeof msg?.name === "string" ? msg.name : "Nuevo token",
                symbol: typeof msg?.symbol === "string" ? msg.symbol : "?",
                createdAt: Date.now(),
                solAmount: typeof msg?.solAmount === "number" ? msg.solAmount : (typeof msg?.quoteAmount === "number" ? msg.quoteAmount : null),
                marketCapSol: mc,
              };
              setInstant((items) => [token, ...items.filter((x) => x.mint !== mint)].slice(0, 80));

              const open = positionsRef.current.filter((p) => p.status === "open");
              const already = positionsRef.current.some((p) => p.mint === mint);
              if (autoPaperRef.current && !already && open.length < SNIPER_MAX_OPEN && mc && mc > 0) {
                const p: PaperSniperPosition = {
                  mint, name: token.name, symbol: token.symbol, openedAt: Date.now(), closedAt: null,
                  status: "open", entryMarketCapSol: mc, currentMarketCapSol: mc, peakMarketCapSol: mc,
                  troughMarketCapSol: mc, grossReturnPct: 0, netReturnPct: -SNIPER_FRICTION_PCT,
                  peakReturnPct: 0, drawdownFromPeakPct: 0, exitReason: null, tradeCount: 0, buys: 0, sells: 0, ticks: [],
                };
                const next = [p, ...positionsRef.current].slice(0, 120);
                positionsRef.current = next;
                setSniperPositions(next);
                ws?.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
              }
              return;
            }

            if (msg?.txType === "buy" || msg?.txType === "sell") {
              const current = positionsRef.current.find((p) => p.mint === mint && p.status === "open");
              if (!current) return;
              const mc = typeof msg?.marketCapSol === "number" ? msg.marketCapSol : (typeof msg?.marketCapQuote === "number" ? msg.marketCapQuote : null);
              if (!mc || mc <= 0) return;
              const side: SniperTick["side"] = msg.txType === "buy" ? "buy" : "sell";
              const { updated, reason } = evaluatePaperTick(current, mc, side, Date.now());
              const next = positionsRef.current.map((p) => p.mint === mint && p.status === "open" ? (reason ? { ...updated, status: "closed" as const, closedAt: Date.now(), exitReason: reason } : updated) : p);
              positionsRef.current = next;
              setSniperPositions(next);
              if (reason) ws?.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [mint] }));
            }
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
      wsRef.current = null;
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
  const sniperOpen = sniperPositions.filter((p) => p.status === "open");
  const sniperClosed = sniperPositions.filter((p) => p.status === "closed");
  const sniperWins = sniperClosed.filter((p) => p.netReturnPct > 0).length;
  const sniperPnlUsd = sniperClosed.reduce((sum, p) => sum + SNIPER_NOTIONAL_USD * (p.netReturnPct / 100), 0);
  return <section className="space-y-5">
    <div className="rounded-2xl border border-[var(--accent-info)]/35 bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">⚡ Launch Radar</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Solo Solana · primeros 5 minutos. Ya no escondemos un lanzamiento por tener poco volumen o liquidez: primero lo ves, después decides si está despertando.</p></div><div className="text-right text-xs text-[var(--text-muted)]"><div className="font-data text-sm"><b>{launch.length}</b> pares &lt;5m</div><div>escaneados: <b>{feed?.scannedTokens ?? 0}</b></div></div></div>
      <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-2 text-[10px] text-[var(--text-muted)]">⚪ NEW → 🟡 WARMING UP → 🟢 ACCELERATING → 🔥 LAUNCHING. Launch Velocity ordena y describe; ya no elimina tokens recién nacidos. Riesgos críticos se marcan como 🔴 DANGER.</div>
    </div>
    <div className="rounded-2xl border border-[var(--accent-opportunity)]/30 bg-[var(--surface)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-display text-base font-semibold">🤖 Auto Paper Sniper</h3><p className="text-[10px] text-[var(--text-faint)]">$10 virtuales · máximo 5 posiciones · sigue trades en tiempo real y vende virtualmente al detectar reversión. Cero wallet, cero SOL.</p></div>
        <button onClick={() => setAutoPaper((v) => !v)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${autoPaper ? "border-[var(--accent-opportunity)]/50 text-[var(--accent-opportunity)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>{autoPaper ? "● AUTO PAPER ON" : "○ AUTO PAPER OFF"}</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg bg-[var(--surface-2)] p-2"><div className="text-[var(--text-faint)]">Abiertas</div><b className="font-data text-lg">{sniperOpen.length}/{SNIPER_MAX_OPEN}</b></div>
        <div className="rounded-lg bg-[var(--surface-2)] p-2"><div className="text-[var(--text-faint)]">Cerradas</div><b className="font-data text-lg">{sniperClosed.length}</b></div>
        <div className="rounded-lg bg-[var(--surface-2)] p-2"><div className="text-[var(--text-faint)]">Win rate</div><b className="font-data text-lg">{sniperClosed.length ? `${((sniperWins / sniperClosed.length) * 100).toFixed(0)}%` : "N/D"}</b></div>
        <div className="rounded-lg bg-[var(--surface-2)] p-2"><div className="text-[var(--text-faint)]">PnL virtual</div><b className={`font-data text-lg ${sniperPnlUsd >= 0 ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-risk)]"}`}>{sniperPnlUsd >= 0 ? "+" : ""}${sniperPnlUsd.toFixed(2)}</b></div>
      </div>
      <div className="text-[10px] text-[var(--text-muted)]">Salida dinámica: hard stop −12%; trailing de ~6–12% desde el máximo según el tamaño del pump; sell pressure; no-momentum; máximo 90s. El PnL resta 3% de fricción estimada, pero NO puede reproducir exactamente slippage/liquidez reales.</div>
      {sniperOpen.length > 0 && <div className="grid lg:grid-cols-2 gap-2">{sniperOpen.map((p) => <div key={p.mint} className="rounded-xl border border-[var(--accent-info)]/30 bg-[var(--surface-2)] p-3">
        <div className="flex justify-between gap-2"><div><b>{p.name}</b> <span className="text-[var(--text-muted)]">${p.symbol}</span><div className="text-[9px] text-[var(--text-faint)]">PAPER · {Math.max(0, Math.floor((clock - p.openedAt)/1000))}s · {p.tradeCount} trades</div></div><div className={`font-data font-bold ${p.netReturnPct >= 0 ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-risk)]"}`}>{pctText(p.netReturnPct)}</div></div>
        <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]"><div>Peak <b className="text-[var(--accent-opportunity)]">{pctText(p.peakReturnPct)}</b></div><div>From peak <b className={p.drawdownFromPeakPct < 0 ? "text-[var(--accent-risk)]" : ""}>{pctText(p.drawdownFromPeakPct)}</b></div><div>B/S <b>{p.buys}/{p.sells}</b></div></div>
        <button onClick={() => closePaper(p.mint, "manual")} className="mt-2 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-muted)]">Cerrar paper ahora</button>
      </div>)}</div>}
      {sniperClosed.length > 0 && <details><summary className="cursor-pointer text-xs text-[var(--text-muted)]">Últimas salidas ({Math.min(sniperClosed.length, 20)})</summary><div className="mt-2 space-y-1">{sniperClosed.slice(0,20).map((p) => <div key={`${p.mint}-${p.openedAt}`} className="flex flex-wrap justify-between gap-2 rounded bg-[var(--surface-2)] px-2 py-1.5 text-[10px]"><span><b>${p.symbol}</b> · {sniperExitLabel(p.exitReason)} · peak {pctText(p.peakReturnPct)}</span><b className={p.netReturnPct >= 0 ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-risk)]"}>{pctText(p.netReturnPct)}</b></div>)}</div></details>}
    </div>

    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-display text-sm font-semibold">⚡ DIRECT LAUNCH STREAM · 0–5 MIN</h3><p className="text-[10px] text-[var(--text-faint)]">Aparecen al crearse; no esperamos a DexScreener.</p></div>
        <div className="text-xs text-[var(--text-muted)]">Stream: <b className={streamState === "live" ? "text-[var(--accent-opportunity)]" : streamState === "offline" ? "text-[var(--accent-risk)]" : "text-[var(--accent-gold)]"}>{streamState === "live" ? "LIVE" : streamState === "offline" ? "OFFLINE" : "CONECTANDO"}</b> · <b>{instant.length}</b> lanzamientos</div>
      </div>
      {instant.length ? <div className="grid lg:grid-cols-2 gap-3">{instant.map((token) => <InstantCard key={token.mint} token={token} now={clock} paperOpen={sniperOpen.some((p) => p.mint === token.mint)} />)}</div> : <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-[var(--text-muted)]">{streamState === "live" ? "Stream conectado. Esperando el próximo token de Pump.fun…" : "Conectando al stream directo de nuevos tokens…"}</div>}
    </div>
    <div className="border-t border-[var(--border)] pt-4"><div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">DexScreener enrichment · cuando el par ya está indexado</div></div>
    {loading && !feed ? <div className="text-sm text-[var(--text-muted)]">Buscando lanzamientos…</div> : groups.map(([title, list]) => <div key={title} className="space-y-2"><div className="flex justify-between"><h3 className="font-display text-sm font-semibold">{title}</h3><span className="text-xs text-[var(--text-muted)]">{list.length}</span></div>{list.length ? <div className="grid lg:grid-cols-2 gap-3">{list.map(c => <LaunchCard key={c.tokenKey} c={c} />)}</div> : <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-[var(--text-muted)]">No hay ningún par confirmado por DexScreener en esta franja de edad ahora mismo. No es un filtro de volumen/liquidez: si existe un par ≤5m que nuestros feeds descubren, debería aparecer aquí.</div>}</div>)}
    <div className="text-[10px] text-[var(--text-faint)]">V20: Direct Launch Stream + Auto Paper Sniper. Las operaciones del Sniper son simuladas en este navegador; no firma, compra ni vende tokens reales. DexScreener sigue siendo la capa de enriquecimiento posterior.</div>
  </section>;
}
