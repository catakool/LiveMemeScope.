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
type SniperExitReason = "hard_stop" | "reversal" | "sell_pressure" | "no_momentum" | "time_exit" | "manual" | "no_data";
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
  observedPriceTicks: number;
  validResult: boolean;
};

const SNIPER_NOTIONAL_USD = 10;
const SNIPER_FRICTION_PCT = 3; // conservative paper estimate; NOT actual execution slippage
const SNIPER_MAX_OPEN = 5; // anonymous PumpDev token-trade subscription pool
const SNIPER_STORAGE_KEY = "memescope:paper-sniper:v21-audit";

// A paper result is only statistically valid after multiple POST-entry quotes
// AND evidence that the observed price actually changed. This prevents a stale
// provider quote from becoming a fake 0% trade that turns into -3% after friction.
const MIN_VALID_PRICE_TICKS = 3;
const MIN_DISTINCT_PRICE_LEVELS = 2;
const MIN_OBSERVED_SPAN_MS = 1_500;
const PRICE_DISTINCT_EPSILON_PCT = 0.05;

// REAL waits for a tiny amount of confirmed post-launch momentum, but enters
// earlier than V25 so it does not systematically arrive after the first impulse.
// These values are deliberately conservative enough to reject a token that has
// already gone vertical before our transaction can land.
const REAL_ENTRY_MIN_AGE_MS = 1_200;
const REAL_ENTRY_MAX_AGE_LIVE_MS = 15_000;
// DexScreener can index a newborn token only after V26.1's old 12-second
// birth-age window had already expired. Fallback mode therefore measures
// eligibility from the first usable observed quote.
const REAL_ENTRY_MAX_OBSERVED_AGE_FALLBACK_MS = 45_000;
const REAL_ENTRY_MIN_RETURN_PCT = 0.35;
const REAL_ENTRY_MAX_RETURN_PCT = 18;
const REAL_ENTRY_MIN_RECENT_MOVE_PCT = 0.35;
const REAL_ENTRY_MIN_BUY_RATIO = 0.58;
const REAL_ENTRY_MAX_DRAWDOWN_PCT = -4.0;

function ret(entry: number, current: number) {
  return entry > 0 ? ((current / entry) - 1) * 100 : 0;
}

function priceTicks(position: PaperSniperPosition): SniperTick[] {
  // Dex anchor ticks are deliberately excluded until evaluatePaperTick records
  // a genuine post-anchor observation by incrementing observedPriceTicks.
  return position.ticks.filter((t) => Number.isFinite(t.marketCapSol) && t.marketCapSol > 0);
}

function distinctObservedPrices(position: PaperSniperPosition): number {
  const ticks = priceTicks(position);
  const levels: number[] = [];
  for (const tick of ticks) {
    if (!levels.some((v) => Math.abs(ret(v, tick.marketCapSol)) <= PRICE_DISTINCT_EPSILON_PCT)) {
      levels.push(tick.marketCapSol);
    }
  }
  return levels.length;
}

function hasValidPaperData(position: PaperSniperPosition): boolean {
  if ((position.observedPriceTicks ?? 0) < MIN_VALID_PRICE_TICKS) return false;
  if (distinctObservedPrices(position) < MIN_DISTINCT_PRICE_LEVELS) return false;
  const ticks = priceTicks(position);
  if (ticks.length < 2) return false;
  const span = ticks[ticks.length - 1].t - ticks[0].t;
  return span >= MIN_OBSERVED_SPAN_MS;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function paperTradePnlUsd(p: PaperSniperPosition): number {
  return SNIPER_NOTIONAL_USD * (p.netReturnPct / 100);
}

function maxPaperDrawdownUsd(trades: PaperSniperPosition[]): number {
  const ordered = [...trades].sort((a,b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  let equity = 0, peak = 0, maxDd = 0;
  for (const trade of ordered) {
    equity += paperTradePnlUsd(trade);
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  return maxDd;
}

function sniperExitLabel(reason: SniperExitReason | null) {
  const labels: Record<SniperExitReason, string> = {
    hard_stop: "HARD STOP", reversal: "REVERSAL", sell_pressure: "SELL PRESSURE",
    no_momentum: "NO MOMENTUM", time_exit: "TIME EXIT", manual: "MANUAL", no_data: "NO DATA",
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
  const [streamSource, setStreamSource] = useState<"pumpdev" | "pumpportal" | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [tradeStreamState, setTradeStreamState] = useState<"live" | "waiting">("waiting");
  const [clock, setClock] = useState(() => Date.now());
  const [autoPaper, setAutoPaper] = useState(true);
  const [sniperPositions, setSniperPositions] = useState<PaperSniperPosition[]>([]);
  const [realArmed, setRealArmed] = useState(false);
  const [realToken, setRealToken] = useState("");
  const [realStatus, setRealStatus] = useState<any>(null);
  const [realBusy, setRealBusy] = useState(false);
  const [realError, setRealError] = useState<string | null>(null);
  const [realMirror, setRealMirror] = useState<PaperSniperPosition | null>(null);
  const realArmedRef = useRef(false);
  const realBusyRef = useRef(false);
  const realTokenRef = useRef("");
  const realOpenMintRef = useRef<string | null>(null);
  const realExitPendingRef = useRef(false);
  const realExitReasonRef = useRef("autonomous_recovery");
  const [entryEngineStatus, setEntryEngineStatus] = useState("ARMED: aguardando candidato");
  const entryEvaluationsRef = useRef(0);
  const entryQualifiedRef = useRef(0);
  const realExitMarketCapRef = useRef<number | null>(null);
  const realMirrorRef = useRef<PaperSniperPosition | null>(null);
  const positionsRef = useRef<PaperSniperPosition[]>([]);
  const autoPaperRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const tradeWsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SNIPER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PaperSniperPosition[];
        // Previous browser sessions cannot be monitored continuously, so any stale open
        // position is closed locally instead of pretending we observed its exit.
        const now = Date.now();
        const safe = parsed.map((raw) => {
          const p: PaperSniperPosition = {
            ...raw,
            observedPriceTicks: raw.observedPriceTicks ?? raw.tradeCount ?? 0,
            validResult: false,
          };
          if (p.status === "open" && now - p.openedAt > 2 * 60_000) {
            const valid = hasValidPaperData(p);
            return {
              ...p,
              status: "closed" as const,
              closedAt: now,
              exitReason: (valid ? "time_exit" : "no_data") as SniperExitReason,
              validResult: valid,
              netReturnPct: valid ? p.grossReturnPct - SNIPER_FRICTION_PCT : 0,
            };
          }
          return p;
        }).slice(0, 120);
        positionsRef.current = safe;
        setSniperPositions(safe);
      }
    } catch {}
  }, []);

  useEffect(() => { autoPaperRef.current = autoPaper; }, [autoPaper]);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem("memescope:real-control:v1");
      if (saved) setRealToken(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (realToken) window.sessionStorage.setItem("memescope:real-control:v1", realToken);
      else window.sessionStorage.removeItem("memescope:real-control:v1");
    } catch {}
  }, [realToken]);

  useEffect(() => { realArmedRef.current = realArmed; }, [realArmed]);
  useEffect(() => { realBusyRef.current = realBusy; }, [realBusy]);
  useEffect(() => { realTokenRef.current = realToken; }, [realToken]);

  const applyRealResponse = (data: any) => {
    if (!data) return;
    setRealStatus((prev: any) => ({ ...(prev ?? {}), ...data }));
    if (data?.state) {
      realOpenMintRef.current = data.state.openMint ?? null;
      if (typeof data.state.armed === "boolean") {
        realArmedRef.current = data.state.armed;
        setRealArmed(data.state.armed);
      }
      if (data.state.openMint && data.state.exitRequested) {
        realExitPendingRef.current = true;
      }
      if (!data.state.openMint) {
        realExitPendingRef.current = false;
        realExitMarketCapRef.current = null;
        realMirrorRef.current = null;
        setRealMirror(null);
      }
    }
  };

  const realRequest = async (method: "GET" | "POST", body?: any) => {
    const token = realTokenRef.current.trim();
    if (!token) throw new Error("Introduce primero el REAL CONTROL TOKEN.");
    const response = await fetch("/api/real-test", {
      method,
      headers: { "Content-Type": "application/json", "x-real-control-token": token },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      cache: "no-store",
    });
    const data = await response.json();
    applyRealResponse(data);
    if (!response.ok || !data?.ok) {
      if (data?.skip) throw new Error(`SKIP_TOKEN · ${data?.reason ?? data?.error ?? "preflight"}`);
      if (data?.retry) throw new Error(`SELL_RETRY · ${data?.error ?? "exit pending"}`);
      throw new Error(data?.error ?? `HTTP ${response.status}`);
    }
    return data;
  };

  const seedRealMirror = (state: any) => {
    const mint = typeof state?.openMint === "string" ? state.openMint : "";
    const mc = Number(state?.openEntryMarketCapSol);
    if (!mint || !(mc > 0)) return null;
    const existing = realMirrorRef.current;
    if (existing?.mint === mint) return existing;
    const mirror: PaperSniperPosition = {
      mint,
      name: state?.openName || "REAL POSITION",
      symbol: state?.openSymbol || "REAL",
      openedAt: Number(state?.openOpenedAt) > 0 ? Number(state.openOpenedAt) : Date.now(),
      closedAt: null,
      status: "open",
      entryMarketCapSol: mc,
      currentMarketCapSol: mc,
      peakMarketCapSol: mc,
      troughMarketCapSol: mc,
      grossReturnPct: 0,
      netReturnPct: 0,
      peakReturnPct: 0,
      drawdownFromPeakPct: 0,
      exitReason: null,
      tradeCount: 0,
      buys: 0,
      sells: 0,
      ticks: [],
      observedPriceTicks: 0,
      validResult: false,
    };
    realMirrorRef.current = mirror;
    setRealMirror(mirror);
    return mirror;
  };

  const recoverRealPosition = async (state: any) => {
    const mint = typeof state?.openMint === "string" ? state.openMint : "";
    if (!mint) return;
    seedRealMirror(state);
    try {
      if (streamSource === "pumpdev" && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
      } else if (tradeWsRef.current?.readyState === WebSocket.OPEN) {
        tradeWsRef.current.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
      }
    } catch {}
  };
  const reconcileRealPosition = async () => {
    if (realBusyRef.current) return;
    try {
      realBusyRef.current = true;
      setRealBusy(true);
      const data = await realRequest("POST", {
        action: "reconcile",
        paperExitMarketCapSol: realExitMarketCapRef.current,
      });
      if (!data?.state?.openMint) {
        realExitPendingRef.current = false;
        realMirrorRef.current = null;
        setRealMirror(null);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "SELL recovery";
      if (!/SELL_RETRY|TRADE_BUSY/i.test(message)) setRealError(message);
    } finally {
      realBusyRef.current = false;
      setRealBusy(false);
    }
  };

  const refreshRealStatus = async () => {
    try {
      setRealError(null);
      const data = await realRequest("GET");
      if (data?.state?.openMint) {
        await recoverRealPosition(data.state);
        const chainKnown = !data?.chainPositionError && data?.chainPosition != null;
        const raw = chainKnown ? String(data.chainPosition.raw ?? "0") : null;
        const ageMs = Math.max(0, Date.now() - Number(data.state.openOpenedAt || data.state.sellRetrySince || data.state.startedAt || Date.now()));
        const staleMs = Math.max(30_000, Number(data?.stalePositionMs ?? 120_000));
        const shouldRecover = (chainKnown && raw === "0") || Boolean(data.state.exitRequested) || ageMs >= staleMs;
        if (shouldRecover) {
          realExitPendingRef.current = true;
          void reconcileRealPosition();
        }
      }
    } catch (e) { setRealError(e instanceof Error ? e.message : "Error REAL TEST"); }
  };

  const realBuyIfArmed = async (mint: string, entryMarketCapSol?: number | null, name?: string, symbol?: string) => {
    // realBusyRef is intentionally synchronous. The old React state closure could
    // launch two BUY requests from two create events arriving milliseconds apart;
    // the second 409 then disarmed a perfectly healthy bot.
    if (!realArmedRef.current || realBusyRef.current || realOpenMintRef.current) return;
    realBusyRef.current = true;
    setRealBusy(true);
    try {
      setRealError(null);
      const data = await realRequest("POST", { action: "buy", mint, entryMarketCapSol, name, symbol });
      realOpenMintRef.current = data?.state?.openMint ?? mint;
      if (data?.state?.openMint) {
        seedRealMirror(data.state);
        setEntryEngineStatus(`FILLED ${symbol || mint.slice(0,6)}: posição REAL aberta`);
      }
      if (data?.state?.stopped || data?.state?.armed === false) {
        realArmedRef.current=false;
        setRealArmed(false);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "BUY real falló";
      const transientSlippage =
        /SKIP_TOKEN|PREBUY_SKIP|TooMuchSolRequired|TooLittleSolReceived|\b6002\b|\b6003\b|\b6005\b|\b6024\b|0x1772|0x1773|0x1775|0x1788|Overflow|BondingCurveComplete|slippage|blockhash|expired/i.test(message);
      if (transientSlippage) {
        // The token ran away before execution. Do NOT chase it and do NOT stop
        // the experiment: skip this mint and wait for the next launch.
        setRealError("SKIP TOKEN · preflight/custo/slippage não passou. Bot continua ARMED.");
        setEntryEngineStatus(`SKIP ${symbol || mint.slice(0,6)}: preflight/execution`);
      } else {
        setRealError(message);
        // Unknown execution/config errors still fail closed.
        realArmedRef.current=false;
        setRealArmed(false);
      }
    } finally {
      realBusyRef.current=false;
      setRealBusy(false);
    }
  };

  const maybeEnterReal = (p: PaperSniperPosition) => {
    if (!realArmedRef.current) {
      setEntryEngineStatus("OFF: REAL não está ARMED");
      return;
    }
    if (realBusyRef.current) {
      setEntryEngineStatus("WAIT: execução REAL ocupada");
      return;
    }
    if (realOpenMintRef.current) {
      setEntryEngineStatus("WAIT: já existe posição REAL");
      return;
    }

    entryEvaluationsRef.current += 1;

    if (!hasValidPaperData(p)) {
      setEntryEngineStatus(`TRACK ${p.symbol}: dados ${Math.min(p.observedPriceTicks ?? 0, MIN_VALID_PRICE_TICKS)}/${MIN_VALID_PRICE_TICKS}`);
      return;
    }

    const now = Date.now();
    const birthAgeMs = now - p.openedAt;
    const ticks = p.ticks.slice(-8);
    if (ticks.length < 3) {
      setEntryEngineStatus(`TRACK ${p.symbol}: poucas cotações`);
      return;
    }

    const directionalTrades = p.buys + p.sells;
    const hasLiveTradeFlow = directionalTrades > 0;
    const firstObservedAt = ticks[0]?.t ?? p.openedAt;
    const observedAgeMs = Math.max(0, now - firstObservedAt);

    // Live trade mode can use token birth age. Dex fallback cannot: provider
    // indexing latency used to make every candidate silently too old.
    const entryClockMs = hasLiveTradeFlow ? birthAgeMs : observedAgeMs;
    const maxEntryAgeMs = hasLiveTradeFlow
      ? REAL_ENTRY_MAX_AGE_LIVE_MS
      : REAL_ENTRY_MAX_OBSERVED_AGE_FALLBACK_MS;

    const recentBase = ticks[Math.max(0, ticks.length - 3)].marketCapSol;
    const recentMove = ret(recentBase, p.currentMarketCapSol);
    const buyRatio = directionalTrades > 0 ? p.buys / directionalTrades : null;

    const earlyEnough = entryClockMs >= REAL_ENTRY_MIN_AGE_MS && entryClockMs <= maxEntryAgeMs;
    const moving =
      p.grossReturnPct >= REAL_ENTRY_MIN_RETURN_PCT &&
      p.grossReturnPct <= REAL_ENTRY_MAX_RETURN_PCT &&
      recentMove >= REAL_ENTRY_MIN_RECENT_MOVE_PCT;
    const notReversing = p.drawdownFromPeakPct > REAL_ENTRY_MAX_DRAWDOWN_PCT;

    const pressureOk = buyRatio == null
      ? (p.observedPriceTicks ?? 0) >= 3 && recentMove >= 0.35
      : p.buys >= 2 && buyRatio >= REAL_ENTRY_MIN_BUY_RATIO;

    if (!earlyEnough) {
      setEntryEngineStatus(
        entryClockMs < REAL_ENTRY_MIN_AGE_MS
          ? `TRACK ${p.symbol}: confirmação ${(entryClockMs/1000).toFixed(1)}s`
          : `PASS ${p.symbol}: janela expirada (${(entryClockMs/1000).toFixed(0)}s)`
      );
      return;
    }
    if (!moving) {
      setEntryEngineStatus(`PASS ${p.symbol}: momentum ${p.grossReturnPct.toFixed(1)}% / recente ${recentMove.toFixed(1)}%`);
      return;
    }
    if (!notReversing) {
      setEntryEngineStatus(`PASS ${p.symbol}: já reverteu ${p.drawdownFromPeakPct.toFixed(1)}%`);
      return;
    }
    if (!pressureOk) {
      setEntryEngineStatus(
        buyRatio == null
          ? `TRACK ${p.symbol}: fallback sem impulso suficiente`
          : `PASS ${p.symbol}: buy ratio ${(buyRatio*100).toFixed(0)}%`
      );
      return;
    }

    entryQualifiedRef.current += 1;
    setEntryEngineStatus(`QUALIFIED ${p.symbol}: enviando preflight REAL`);
    void realBuyIfArmed(p.mint, p.currentMarketCapSol, p.name, p.symbol);
  };
  const realSellIfOpen = async (mint: string, reason: string, paperExitMarketCapSol?: number | null) => {
    if (realOpenMintRef.current !== mint || realBusyRef.current || realExitPendingRef.current) return;
    realExitPendingRef.current = true;
    realExitReasonRef.current = reason || "autonomous_exit";
    if (paperExitMarketCapSol && paperExitMarketCapSol > 0) realExitMarketCapRef.current = paperExitMarketCapSol;
    try {
      realBusyRef.current = true;
      setRealBusy(true);
      setRealError(null);
      const data = await realRequest("POST", {
        action: "sell",
        mint,
        reason,
        paperExitMarketCapSol: realExitMarketCapRef.current,
      });
      if (!data?.state?.openMint) {
        realExitPendingRef.current = false;
        realExitMarketCapRef.current = null;
        realMirrorRef.current = null;
        setRealMirror(null);
        try {
          wsRef.current?.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [mint] }));
          tradeWsRef.current?.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [mint] }));
        } catch {}
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "SELL retry";
      if (!/SELL_RETRY|TRADE_BUSY/i.test(msg)) setRealError(`SELL recovery · ${msg}`);
    } finally {
      realBusyRef.current = false;
      setRealBusy(false);
    }
  };

  const updateRealMirrorTick = (mint: string, marketCapSol: number, side: SniperTick["side"], now: number) => {
    const current = realMirrorRef.current;
    if (!current || current.mint !== mint || current.status !== "open" || !(marketCapSol > 0)) return;
    const { updated, reason } = evaluatePaperTick(current, marketCapSol, side, now);
    realMirrorRef.current = updated;
    setRealMirror(updated);
    // PAPER needs three observations to call a result statistically valid. REAL
    // capital does not get that luxury: one post-fill quote below -12% is enough
    // to request an emergency exit instead of waiting for validation ticks.
    const emergencyHardStop = updated.observedPriceTicks >= 1 && updated.grossReturnPct <= -12;
    if ((reason || emergencyHardStop) && !realExitPendingRef.current) {
      void realSellIfOpen(mint, reason ?? "hard_stop", marketCapSol);
    }
  };
  useEffect(() => {
    if (!realToken) return;
    refreshRealStatus();
    const id = window.setInterval(refreshRealStatus, 10_000);
    return () => window.clearInterval(id);
  }, [realToken]);
  useEffect(() => {
    if (!realToken) return;
    const id = window.setInterval(() => {
      if (!realOpenMintRef.current || !realExitPendingRef.current || realBusyRef.current) return;
      void reconcileRealPosition();
    }, 4_000);
    return () => window.clearInterval(id);
  }, [realToken]);

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
      const valid = hasValidPaperData(p);
      // Manual close is also NO DATA when the tracker never established a valid
      // market series. We refuse to turn provider failure into trading PnL.
      const finalReason: SniperExitReason = valid ? reason : "no_data";
      closed = true;
      return {
        ...p,
        status: "closed" as const,
        closedAt: now,
        currentMarketCapSol: current,
        grossReturnPct: valid ? gross : 0,
        netReturnPct: valid ? gross - SNIPER_FRICTION_PCT : 0,
        exitReason: finalReason,
        validResult: valid,
      };
    });
    if (!closed) return;
    positionsRef.current = next;
    setSniperPositions(next);
    // PAPER and REAL share the same policy, but REAL is anchored at its later,
    // actual entry. A birth-anchored PAPER close must not directly liquidate REAL.
    if (realOpenMintRef.current !== mint) {
      try { wsRef.current?.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [mint] })); } catch {}
    }
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
    const nextObservedCount = (position.observedPriceTicks ?? 0) + 1;
    const provisional: PaperSniperPosition = {
      ...position,
      currentMarketCapSol: marketCapSol,
      ticks,
      observedPriceTicks: nextObservedCount,
    };
    const enoughMarketData = hasValidPaperData(provisional);

    // Before data quality is established the bot may TRACK the quote, but it
    // cannot declare a win/loss/stop/reversal.
    if (enoughMarketData && gross <= -12) reason = "hard_stop";
    else if (enoughMarketData && ageMs >= 2_000 && peakReturn >= 8) {
      // A price-only trailing stop works on BOTH PumpDev and DexScreener fallback.
      // V25 incorrectly made smaller trailing exits depend on sell-side trade data,
      // which Dex fallback does not have and could therefore ride a winner down.
      const trail = peakReturn >= 100 ? -12 : peakReturn >= 50 ? -10 : peakReturn >= 20 ? -8 : -6;
      if (drawdown <= trail) reason = "reversal";
    }
    if (!reason && enoughMarketData && ageMs >= 4_000 && gross > 3 && sellCount >= 3 && sellCount >= buyCount * 2) reason = "sell_pressure";
    if (!reason && enoughMarketData && ageMs >= 30_000 && peakReturn < 5 && gross <= 0) reason = "no_momentum";
    // Time exit with insufficient data is handled by closePaper -> NO DATA.
    if (!reason && enoughMarketData && ageMs >= 90_000) reason = "time_exit";

    const updated: PaperSniperPosition = {
      ...position, currentMarketCapSol: marketCapSol, peakMarketCapSol: peak,
      troughMarketCapSol: Math.min(position.troughMarketCapSol, marketCapSol),
      grossReturnPct: gross, netReturnPct: gross, peakReturnPct: peakReturn,
      drawdownFromPeakPct: drawdown, tradeCount: position.tradeCount + 1, observedPriceTicks: (position.observedPriceTicks ?? 0) + 1,
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
      const real = realMirrorRef.current;
      if (real && real.status === "open" && now - real.openedAt >= 90_000 && !realExitPendingRef.current) {
        void realSellIfOpen(real.mint, "time_exit", real.currentMarketCapSol);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnect: number | null = null;
    let connectTimeout: number | null = null;
    let stopped = false;
    let providerIndex = 0;

    const providers = [
      { name: "pumpdev" as const, url: "wss://pumpdev.io/ws", supportsTrades: true },
      // PumpPortal is a fallback for NEW TOKEN events. Their current trade-data
      // subscriptions may require an API key/funded linked wallet, so V20.1 does
      // NOT subscribe to token trades there. Open paper positions fall back to
      // DexScreener price polling instead.
      { name: "pumpportal" as const, url: "wss://pumpportal.fun/api/data", supportsTrades: false },
    ];

    const scheduleReconnect = () => {
      if (stopped) return;
      if (reconnect !== null) window.clearTimeout(reconnect);
      reconnect = window.setTimeout(() => {
        providerIndex = 0;
        connect();
      }, 4_000);
    };

    const tryNextProvider = (reason: string) => {
      if (stopped) return;
      setStreamError(reason);
      try {
        if (ws) {
          ws.onclose = null;
          ws.onerror = null;
          ws.close();
        }
      } catch {}
      ws = null;
      wsRef.current = null;
      providerIndex += 1;
      if (providerIndex < providers.length) {
        window.setTimeout(connect, 250);
      } else {
        setStreamState("offline");
        setStreamSource(null);
        scheduleReconnect();
      }
    };

    const connect = () => {
      if (stopped) return;
      const provider = providers[providerIndex];
      if (!provider) {
        setStreamState("offline");
        scheduleReconnect();
        return;
      }
      setStreamState("connecting");
      setStreamSource(provider.name);
      setStreamError(null);
      try {
        ws = new WebSocket(provider.url);
        wsRef.current = ws;

        // A socket that never reaches OPEN is functionally offline. Move to fallback.
        connectTimeout = window.setTimeout(() => {
          if (ws && ws.readyState !== WebSocket.OPEN) {
            tryNextProvider(`${provider.name}: timeout al conectar`);
          }
        }, 5_000);

        ws.onopen = () => {
          if (connectTimeout !== null) window.clearTimeout(connectTimeout);
          setStreamState("live");
          setStreamSource(provider.name);
          setStreamError(null);
          ws?.send(JSON.stringify({ method: "subscribeNewToken" }));
          if (provider.supportsTrades) {
            const paperMints = positionsRef.current.filter((p) => p.status === "open").slice(0, SNIPER_MAX_OPEN).map((p) => p.mint);
            const openMints = [...new Set([...paperMints, ...(realOpenMintRef.current ? [realOpenMintRef.current] : [])])];
            if (openMints.length) ws?.send(JSON.stringify({ method: "subscribeTokenTrade", keys: openMints }));
          }
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data));
            // Some providers return an error/status frame without a mint.
            if (msg?.error) {
              setStreamError(`${provider.name}: ${String(msg.error).slice(0, 120)}`);
              return;
            }
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
                  troughMarketCapSol: mc, grossReturnPct: 0, netReturnPct: 0,
                  peakReturnPct: 0, drawdownFromPeakPct: 0, exitReason: null, tradeCount: 0, buys: 0, sells: 0, ticks: [], observedPriceTicks: 0, validResult: false,
                };
                const next = [p, ...positionsRef.current].slice(0, 120);
                positionsRef.current = next;
                setSniperPositions(next);
                // V26 REAL waits for confirmed momentum; no blind BUY at creation.
                if (provider.supportsTrades) {
                  ws?.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
                } else if (tradeWsRef.current?.readyState === WebSocket.OPEN) {
                  tradeWsRef.current.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
                }
              }
              return;
            }

            if (provider.supportsTrades && (msg?.txType === "buy" || msg?.txType === "sell")) {
              const mc = typeof msg?.marketCapSol === "number" ? msg.marketCapSol : (typeof msg?.marketCapQuote === "number" ? msg.marketCapQuote : null);
              if (!mc || mc <= 0) return;
              const side: SniperTick["side"] = msg.txType === "buy" ? "buy" : "sell";
              const now = Date.now();
              updateRealMirrorTick(mint, mc, side, now);
              const current = positionsRef.current.find((p) => p.mint === mint && p.status === "open");
              if (!current) return;
              const { updated, reason } = evaluatePaperTick(current, mc, side, now);
              if (reason) {
                // Store the latest validated tick first, then route ALL closure
                // through closePaper so one code path decides validity/PnL.
                const staged = positionsRef.current.map((p) => p.mint === mint && p.status === "open" ? updated : p);
                positionsRef.current = staged;
                setSniperPositions(staged);
                closePaper(mint, reason, mc);
                if (realOpenMintRef.current !== mint) {
                  try { ws?.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [mint] })); } catch {}
                }
              } else {
                const next = positionsRef.current.map((p) => p.mint === mint && p.status === "open" ? updated : p);
                positionsRef.current = next;
                setSniperPositions(next);
                maybeEnterReal(updated);
              }
            }
          } catch (error) {
            setStreamError(`${provider.name}: mensaje no válido`);
          }
        };

        ws.onerror = () => {
          if (ws?.readyState !== WebSocket.OPEN) {
            tryNextProvider(`${provider.name}: WebSocket rechazado/no disponible`);
          } else {
            setStreamError(`${provider.name}: error de WebSocket`);
          }
        };
        ws.onclose = (event) => {
          if (connectTimeout !== null) window.clearTimeout(connectTimeout);
          if (stopped) return;
          // If the current provider never opened (or closes abnormally), try fallback.
          if (providerIndex < providers.length - 1) {
            tryNextProvider(`${provider.name}: conexión cerrada (${event.code})`);
          } else {
            setStreamState("offline");
            setStreamError(`${provider.name}: conexión cerrada (${event.code})`);
            setStreamSource(null);
            scheduleReconnect();
          }
        };
      } catch (error) {
        tryNextProvider(`${provider.name}: no se pudo crear WebSocket`);
      }
    };
    connect();
    return () => {
      stopped = true;
      if (reconnect !== null) window.clearTimeout(reconnect);
      if (connectTimeout !== null) window.clearTimeout(connectTimeout);
      ws?.close();
      wsRef.current = null;
    };
  }, []);

  // While PumpPortal is keeping launch discovery alive, keep retrying PumpDev in
  // a SEPARATE trades-only socket. If it comes back, paper positions immediately
  // regain real buy/sell ticks without interrupting the launch stream.
  useEffect(() => {
    if (!(streamState === "live" && streamSource === "pumpportal")) {
      setTradeStreamState(streamSource === "pumpdev" && streamState === "live" ? "live" : "waiting");
      return;
    }
    let stopped = false;
    let retry: number | null = null;
    let socket: WebSocket | null = null;

    const applyTrade = (msg: any) => {
      const mint = typeof msg?.mint === "string" ? msg.mint : "";
      if (!mint || (msg?.txType !== "buy" && msg?.txType !== "sell")) return;
      const mc = typeof msg?.marketCapSol === "number" ? msg.marketCapSol : (typeof msg?.marketCapQuote === "number" ? msg.marketCapQuote : null);
      if (!mc || mc <= 0) return;
      const side: SniperTick["side"] = msg.txType === "buy" ? "buy" : "sell";
      const now = Date.now();
      updateRealMirrorTick(mint, mc, side, now);
      const current = positionsRef.current.find((p) => p.mint === mint && p.status === "open");
      if (!current) return;
      const { updated, reason } = evaluatePaperTick(current, mc, side, now);
      if (reason) {
        const staged = positionsRef.current.map((p) => p.mint === mint && p.status === "open" ? updated : p);
        positionsRef.current = staged;
        setSniperPositions(staged);
        closePaper(mint, reason, mc);
        if (realOpenMintRef.current !== mint) {
          try { socket?.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [mint] })); } catch {}
        }
      } else {
        const next = positionsRef.current.map((p) => p.mint === mint && p.status === "open" ? updated : p);
        positionsRef.current = next;
        setSniperPositions(next);
                maybeEnterReal(updated);
      }
    };

    const connectTrades = () => {
      if (stopped) return;
      try {
        socket = new WebSocket("wss://pumpdev.io/ws");
        tradeWsRef.current = socket;
        const timeout = window.setTimeout(() => { if (socket?.readyState !== WebSocket.OPEN) socket?.close(); }, 5_000);
        socket.onopen = () => {
          window.clearTimeout(timeout);
          setTradeStreamState("live");
          const paperKeys = positionsRef.current.filter((p) => p.status === "open").slice(0, SNIPER_MAX_OPEN).map((p) => p.mint);
          const keys = [...new Set([...paperKeys, ...(realOpenMintRef.current ? [realOpenMintRef.current] : [])])];
          if (keys.length) socket?.send(JSON.stringify({ method: "subscribeTokenTrade", keys }));
        };
        socket.onmessage = (event) => { try { applyTrade(JSON.parse(String(event.data))); } catch {} };
        socket.onerror = () => setTradeStreamState("waiting");
        socket.onclose = () => {
          setTradeStreamState("waiting");
          tradeWsRef.current = null;
          if (!stopped) retry = window.setTimeout(connectTrades, 10_000);
        };
      } catch {
        setTradeStreamState("waiting");
        retry = window.setTimeout(connectTrades, 10_000);
      }
    };
    connectTrades();
    return () => {
      stopped = true;
      if (retry !== null) window.clearTimeout(retry);
      socket?.close();
      tradeWsRef.current = null;
    };
  }, [streamState, streamSource]);

  // Fallback paper-price monitor. When PumpDev trade streaming is unavailable
  // (for example because the browser/provider rejects that socket), positions are
  // still evaluated from DexScreener every ~2.5s. This preserves trailing/hard-stop
  // testing, but sell-pressure exits require PumpDev's real trade stream.
  useEffect(() => {
    let stopped = false;
    let busy = false;
    const poll = async () => {
      if (stopped || busy) return;
      // PumpDev LIVE already gives tick-by-tick trade events; do not duplicate them.
      if (streamState === "live" && streamSource === "pumpdev") return;
      const open = positionsRef.current.filter((p) => p.status === "open").slice(0, SNIPER_MAX_OPEN);
      const realOpenMint = realOpenMintRef.current;
      if (!open.length && !realOpenMint) return;
      busy = true;
      try {
        const addresses = [...new Set([...open.map((p) => p.mint), ...(realOpenMint ? [realOpenMint] : [])])].join(",");
        const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${addresses}`, { cache: "no-store" });
        if (!res.ok) return;
        const pairs = await res.json() as Array<{ baseToken?: { address?: string }; quoteToken?: { address?: string }; marketCap?: number; fdv?: number; priceUsd?: string }>;
        const now = Date.now();
        const next = [...positionsRef.current];
        let changed = false;
        for (const position of open) {
          const pair = pairs.find((x) => x.baseToken?.address === position.mint || x.quoteToken?.address === position.mint);
          const mcUsd = typeof pair?.marketCap === "number" ? pair.marketCap : (typeof pair?.fdv === "number" ? pair.fdv : null);
          if (!mcUsd || mcUsd <= 0) continue;
          // We only need a consistent relative price proxy. The entry from the launch
          // stream is denominated in SOL, so establish a USD->relative bridge on the
          // first Dex observation instead of pretending USD market cap equals SOL MC.
          const idx = next.findIndex((p) => p.mint === position.mint && p.status === "open");
          if (idx < 0) continue;
          const p = next[idx];
          const existingDexTick = p.ticks.find((t) => t.side === "other" && (t as SniperTick & { dexUsd?: number }).dexUsd != null) as (SniperTick & { dexUsd?: number }) | undefined;
          const anchorUsd = existingDexTick?.dexUsd;
          const relativeMc = anchorUsd && anchorUsd > 0 && existingDexTick
            ? existingDexTick.marketCapSol * (mcUsd / anchorUsd)
            : p.currentMarketCapSol;
          const tick = { t: now, marketCapSol: relativeMc, side: "other" as const, dexUsd: mcUsd } as SniperTick & { dexUsd: number };
          const base = { ...p, ticks: [...p.ticks, tick].slice(-80) };
          if (!anchorUsd) {
            // First DexScreener quote is only a cross-currency anchor. It is NOT a
            // post-entry price observation and must not create a fake 0%/-3% trade.
            next[idx] = base;
            changed = true;
            continue;
          }
          const evaluated = evaluatePaperTick(base, relativeMc, "other", now);
          if (evaluated.reason && hasValidPaperData(evaluated.updated)) {
            next[idx] = {
              ...evaluated.updated,
              status: "closed" as const,
              closedAt: now,
              exitReason: evaluated.reason,
              netReturnPct: evaluated.updated.grossReturnPct - SNIPER_FRICTION_PCT,
              validResult: true,
            };
          } else {
            next[idx] = evaluated.updated;
            maybeEnterReal(evaluated.updated);
          }
          changed = true;
        }

        const realPosition = realMirrorRef.current;
        if (realPosition && realPosition.status === "open") {
          const pair = pairs.find((x) => x.baseToken?.address === realPosition.mint || x.quoteToken?.address === realPosition.mint);
          const mcUsd = typeof pair?.marketCap === "number" ? pair.marketCap : (typeof pair?.fdv === "number" ? pair.fdv : null);
          if (mcUsd && mcUsd > 0) {
            const existingDexTick = realPosition.ticks.find((t) => t.side === "other" && (t as SniperTick & { dexUsd?: number }).dexUsd != null) as (SniperTick & { dexUsd?: number }) | undefined;
            const anchorUsd = existingDexTick?.dexUsd;
            if (!anchorUsd) {
              const anchorTick = { t: now, marketCapSol: realPosition.currentMarketCapSol, side: "other" as const, dexUsd: mcUsd } as SniperTick & { dexUsd: number };
              const anchored = { ...realPosition, ticks: [...realPosition.ticks, anchorTick].slice(-80) };
              realMirrorRef.current = anchored;
              setRealMirror(anchored);
            } else {
              const relativeMc = existingDexTick.marketCapSol * (mcUsd / anchorUsd);
              updateRealMirrorTick(realPosition.mint, relativeMc, "other", now);
            }
          }
        }

        if (changed) {
          positionsRef.current = next;
          setSniperPositions(next);
        }
      } catch {
        // Keep UI alive; next interval retries.
      } finally {
        busy = false;
      }
    };
    poll();
    const id = window.setInterval(poll, 2_500);
    return () => { stopped = true; window.clearInterval(id); };
  }, [streamState, streamSource]);

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
  const sniperValid = sniperClosed.filter((p) => p.validResult !== false && p.exitReason !== "no_data");
  const sniperNoData = sniperClosed.length - sniperValid.length;
  const sniperWins = sniperValid.filter((p) => p.netReturnPct > 0).length;
  const sniperPnlUsd = sniperValid.reduce((sum, p) => sum + paperTradePnlUsd(p), 0);
  const sniperReturns = sniperValid.map((p) => p.netReturnPct);
  const sniperMedianReturn = median(sniperReturns);
  const grossProfitUsd = sniperValid.filter((p) => p.netReturnPct > 0).reduce((sum,p) => sum + paperTradePnlUsd(p), 0);
  const grossLossUsd = Math.abs(sniperValid.filter((p) => p.netReturnPct < 0).reduce((sum,p) => sum + paperTradePnlUsd(p), 0));
  const profitFactor = grossLossUsd > 0 ? grossProfitUsd / grossLossUsd : (grossProfitUsd > 0 ? Infinity : null);
  const maxDrawdownUsd = maxPaperDrawdownUsd(sniperValid);
  const bestTrade = sniperValid.length ? [...sniperValid].sort((a,b) => b.netReturnPct - a.netReturnPct)[0] : null;
  const worstTrade = sniperValid.length ? [...sniperValid].sort((a,b) => a.netReturnPct - b.netReturnPct)[0] : null;
  const trimCount = sniperValid.length ? Math.max(1, Math.ceil(sniperValid.length * 0.01)) : 0;
  const trimmedTrades = [...sniperValid].sort((a,b) => b.netReturnPct - a.netReturnPct).slice(trimCount);
  const pnlWithoutTop1Pct = trimmedTrades.reduce((sum,p) => sum + paperTradePnlUsd(p), 0);
  const topTradeShare = sniperPnlUsd > 0 && bestTrade ? (paperTradePnlUsd(bestTrade) / sniperPnlUsd) * 100 : null;
  const realTrackedPosition = realStatus?.state?.openMint && realMirror?.mint === realStatus.state.openMint
    ? realMirror
    : null;
  return <section className="space-y-5">
    <div className="rounded-2xl border border-[var(--accent-info)]/35 bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">⚡ Launch Radar</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Solo Solana · primeros 5 minutos. Ya no escondemos un lanzamiento por tener poco volumen o liquidez: primero lo ves, después decides si está despertando.</p></div><div className="text-right text-xs text-[var(--text-muted)]"><div className="font-data text-sm"><b>{launch.length}</b> pares &lt;5m</div><div>escaneados: <b>{feed?.scannedTokens ?? 0}</b></div></div></div>
      <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-2 text-[10px] text-[var(--text-muted)]">⚪ NEW → 🟡 WARMING UP → 🟢 ACCELERATING → 🔥 LAUNCHING. Launch Velocity ordena y describe; ya no elimina tokens recién nacidos. Riesgos críticos se marcan como 🔴 DANGER.</div>
    </div>
    <div className="rounded-2xl border border-[var(--accent-risk)]/35 bg-[var(--surface)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-display text-base font-semibold">🧠 V26.2 REAL CORE · ENTRY PIPELINE FIX</h3><p className="text-[10px] text-[var(--text-muted)]">Máximo 20 BUY reais · 1 posição ativa · entrada confirmada + preflight. O mirror REAL é ancorado no fill efetivo, não no preço anterior do PAPER. Saída autónoma com trailing/stop, reconciliação on-chain e quarentena automática de tokens realmente invendáveis.</p></div>
        <div className={`font-data text-xs font-bold ${realArmed ? "text-[var(--accent-risk)]" : "text-[var(--text-muted)]"}`}>{realArmed ? "● ARMED" : "○ SAFE / OFF"}</div>
      </div>
      <div className="grid md:grid-cols-[1fr_auto_auto] gap-2">
        <input type="password" value={realToken} onChange={(e)=>setRealToken(e.target.value)} placeholder="REAL CONTROL TOKEN (no es tu seed)" className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs outline-none" />
        <button onClick={refreshRealStatus} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">Comprobar wallet</button>
        <button disabled={!realStatus?.ok || realBusy || (realStatus?.state?.stopped && realStatus?.state?.stopReason !== "manual")} onClick={async()=>{
          try{
            const data=await realRequest("POST",{action:realArmed?"disarm":"arm"});
            const armed=Boolean(data?.state?.armed);
            realArmedRef.current=armed; setRealArmed(armed);
          }catch(e){setRealError(e instanceof Error?e.message:"No se pudo cambiar ARMED");}
        }} className={`rounded-lg border px-3 py-2 text-xs font-bold ${realArmed ? "border-[var(--accent-risk)] text-[var(--accent-risk)]" : "border-[var(--accent-opportunity)]/50 text-[var(--accent-opportunity)]"} disabled:opacity-40`}>{realArmed ? "DESARMAR" : "ARM REAL TEST"}</button>
      </div>
      {realStatus?.ok && <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
        <div className="rounded bg-[var(--surface-2)] p-2">Saldo SOL<div className="font-data font-bold">{Number(realStatus.wallet?.balanceSol ?? 0).toFixed(5)}</div><div className="text-[9px] text-[var(--text-faint)]">{realStatus.wallet?.publicKey?.slice(0,6)}…{realStatus.wallet?.publicKey?.slice(-4)}</div></div>
        <div className="rounded bg-[var(--surface-2)] p-2">Entradas<div className="font-data font-bold">{realStatus.state?.entries ?? 0}/20</div><div className="text-[9px] text-[var(--text-faint)]">skips: {Number(realStatus.state?.skippedBuys)||0}</div></div>
        <div className="rounded bg-[var(--surface-2)] p-2 md:col-span-2">Entry engine<div className="font-data text-[11px] font-bold">{entryEngineStatus}</div><div className="text-[9px] text-[var(--text-faint)]">evaluados: {entryEvaluationsRef.current} · qualified: {entryQualifiedRef.current}</div></div>
        <div className="rounded bg-[var(--surface-2)] p-2">Compra/entrada<div className="font-data font-bold">{Math.round(Number(realStatus.buyFraction ?? .20)*100)}% saldo</div><div className="text-[9px] text-[var(--text-faint)]">preflight antes do envio</div></div>
        <div className="rounded bg-[var(--surface-2)] p-2">PnL REAL<div className={`font-data font-bold ${(Number(realStatus.state?.realizedPnlSol)||0)>=0?"text-[var(--accent-opportunity)]":"text-[var(--accent-risk)]"}`}>{(Number(realStatus.state?.realizedPnlSol)||0)>=0?"+":""}{(Number(realStatus.state?.realizedPnlSol)||0).toFixed(6)} SOL</div><div className="text-[9px] text-[var(--text-faint)]">W/L {Number(realStatus.state?.wins)||0}/{Number(realStatus.state?.losses)||0}</div></div>
      </div>}
      {realStatus?.state?.openMint && <div className="rounded-xl border border-[var(--accent-risk)]/35 bg-[var(--surface-2)] p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><div className="text-[9px] font-semibold text-[var(--accent-risk)]">● REAL POSITION · MANAGED AUTOMATICALLY</div><b>{realStatus.state?.openName || realTrackedPosition?.name || "Token real"}</b> <span className="text-[var(--text-muted)]">${realStatus.state?.openSymbol || realTrackedPosition?.symbol || "?"}</span><div className="font-data text-[9px] text-[var(--text-faint)]">{String(realStatus.state.openMint)}</div></div>
          <div className="text-right"><div className="text-[9px] text-[var(--text-faint)]">estado</div><b className="text-[var(--accent-opportunity)]">{realStatus.state?.exitRequested || realExitPendingRef.current ? `SELL RETRY ${Number(realStatus.state?.sellRetryCount)||0}` : "MONITORING"}</b></div>
        </div>
        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
          <div>Mirror desde entry real<div className="font-data font-semibold">{realTrackedPosition && Number(realStatus.state?.openEntryMarketCapSol)>0 ? pctText(ret(Number(realStatus.state.openEntryMarketCapSol), realTrackedPosition.currentMarketCapSol)) : "a validar"}</div></div>
          <div>Peak monitor<div className="font-data font-semibold">{realTrackedPosition ? pctText(realTrackedPosition.peakReturnPct) : "a validar"}</div></div>
          <div>Idade<div className="font-data font-semibold">{realStatus.state?.openOpenedAt ? `${Math.max(0,Math.floor((clock-Number(realStatus.state.openOpenedAt))/1000))}s` : "—"}</div></div>
          <div>On-chain<div className="font-data font-semibold">{realStatus?.chainPositionError ? "RPC a reintentar" : String(realStatus?.chainPosition?.raw ?? "0") === "0" ? "0 tokens" : `${String(realStatus?.chainPosition?.raw ?? "?").slice(0,12)} raw`}</div><div className="text-[9px] text-[var(--text-faint)]">{realStatus?.chainPositionError ? "estado preservado" : `${Number(realStatus?.chainPosition?.accounts?.length)||0} account(s)`}</div></div>
        </div>
      </div>}
      {realStatus?.ok && <div className="rounded-xl border border-[var(--accent-info)]/25 bg-[var(--surface-2)] p-3 text-[10px]">
        <b>Paper ↔ Real · última saída</b>
        <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>Signal→exit<div className="font-data">{realStatus.state?.lastSignalReturnPct == null ? "N/D" : pctText(Number(realStatus.state.lastSignalReturnPct))}</div></div>
          <div>Entry gap<div className={`font-data ${Number(realStatus.state?.lastEntryGapPct)>5?"text-[var(--accent-risk)]":""}`}>{realStatus.state?.lastEntryGapPct == null ? "N/D" : pctText(Number(realStatus.state.lastEntryGapPct))}</div></div>
          <div>Fill mirror<div className="font-data">{realStatus.state?.lastPaperMirrorReturnPct == null ? "N/D" : pctText(Number(realStatus.state.lastPaperMirrorReturnPct))}</div></div>
          <div>Real líquido<div className="font-data">{realStatus.state?.lastTradeReturnPct == null ? "N/D" : pctText(Number(realStatus.state.lastTradeReturnPct))}</div><div className={`font-data text-[9px] ${Number(realStatus.state?.lastExecutionGapPct)<0?"text-[var(--accent-risk)]":"text-[var(--accent-opportunity)]"}`}>gap {realStatus.state?.lastExecutionGapPct == null ? "N/D" : pctText(Number(realStatus.state.lastExecutionGapPct))}</div></div>
        </div>
      </div>}
      <div className="flex flex-wrap gap-2">
        <button onClick={async()=>{ try{ const data=await realRequest("POST",{action:"stop"}); realArmedRef.current=false; setRealArmed(false); setRealStatus(data); }catch(e){setRealError(e instanceof Error?e.message:"Error");}}} className="rounded-lg border border-[var(--accent-risk)] px-3 py-1.5 text-xs font-bold text-[var(--accent-risk)]">■ KILL SWITCH</button>
        {realStatus?.state?.openMint && <button disabled={realBusy} onClick={async()=>{
          realExitPendingRef.current = true;
          realExitReasonRef.current = "emergency_reconcile";
          await reconcileRealPosition();
          await refreshRealStatus();
        }} className="rounded-lg border border-[var(--accent-gold)]/60 px-3 py-1.5 text-xs font-bold text-[var(--accent-gold)] disabled:opacity-40">EMERGENCY RECOVER (backup)</button>}
        <button onClick={async()=>{ if(!confirm("¿Resetear contador REAL TEST? Hazlo solo antes de una prueba nueva.")) return; try{ await realRequest("POST",{action:"reset"}); setRealArmed(false); }catch(e){setRealError(e instanceof Error?e.message:"Error");}}} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]">Reset contador</button>
        {realStatus?.state?.lastSignature && <a className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs" target="_blank" rel="noreferrer" href={`https://solscan.io/tx/${realStatus.state.lastSignature}`}>Última TX ↗</a>}
      </div>
      {realStatus?.state?.lastAction && <div className="text-[10px] text-[var(--text-muted)]">Última acción: <b>{realStatus.state.lastAction}</b>{realStatus.state?.stopReason ? <span> · stop: <b>{String(realStatus.state.stopReason)}</b></span> : null}{Number(realStatus.state?.abandonedCount)>0 ? <span> · quarantine: <b>{Number(realStatus.state.abandonedCount)}</b></span> : null}</div>}
      {realStatus?.state?.lastQuarantineReason && <div className="rounded-lg border border-[var(--accent-gold)]/30 bg-[var(--accent-gold)]/5 p-2 text-[10px] text-[var(--text-muted)]">Quarantine não significa “vendido”: o runner deixou de ficar bloqueado por um token sem rota executável e registou o custo de forma conservadora. Último motivo: {String(realStatus.state.lastQuarantineReason).slice(0,240)}</div>}
      {(realError || realStatus?.state?.lastError || realStatus?.state?.lastSellError) && <div className="rounded-lg border border-[var(--accent-risk)]/40 bg-[var(--accent-risk)]/5 p-2 text-[10px] text-[var(--accent-risk)]">{realError ?? realStatus.state.lastError ?? realStatus.state.lastSellError}</div>}
      <div className="text-[9px] text-[var(--text-faint)]">V26.2 REAL CORE: Dex fallback usa idade desde a primeira cotação observável; o Entry engine mostra TRACK/PASS/QUALIFIED/SKIP/FILLED para nunca mais parecer morto sem diagnóstico. o fill REAL é calculado a partir do SOL enviado, tokens realmente recebidos e supply on-chain. PAPER/REAL partilham a política de saída, inclusive no fallback DexScreener. SELL reconcilia saldo on-chain, alterna pools/slippage e pode usar Jupiter V2 como rota independente. Uma posição antiga que continue realmente invendável após recuperação é QUARANTINED e deixa de bloquear o runner; nunca é apresentada como se tivesse sido vendida. BUY 6002/6024/slippage vira SKIP. PnL REAL inclui fees.</div>
    </div>

    <div className="rounded-2xl border border-[var(--accent-opportunity)]/30 bg-[var(--surface)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-display text-base font-semibold">🤖 Auto Paper Sniper</h3><p className="text-[10px] text-[var(--text-faint)]">$10 virtuales · máximo 5 posiciones · usa trades en tiempo real cuando PumpDev está disponible; si no, activa monitor de precio DexScreener. Cero wallet, cero SOL.</p></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setAutoPaper((v) => !v)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${autoPaper ? "border-[var(--accent-opportunity)]/50 text-[var(--accent-opportunity)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>{autoPaper ? "● AUTO PAPER ON" : "○ AUTO PAPER OFF"}</button>
          <button onClick={() => {
            positionsRef.current = [];
            setSniperPositions([]);
            try { window.localStorage.removeItem(SNIPER_STORAGE_KEY); } catch {}
          }} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]">🗑 Reset paper</button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg bg-[var(--surface-2)] p-2"><div className="text-[var(--text-faint)]">Abiertas</div><b className="font-data text-lg">{sniperOpen.length}/{SNIPER_MAX_OPEN}</b></div>
        <div className="rounded-lg bg-[var(--surface-2)] p-2"><div className="text-[var(--text-faint)]">Cerradas</div><b className="font-data text-lg">{sniperValid.length}</b><div className="text-[9px] text-[var(--text-faint)]">NO DATA: {sniperNoData}</div></div>
        <div className="rounded-lg bg-[var(--surface-2)] p-2"><div className="text-[var(--text-faint)]">Win rate</div><b className="font-data text-lg">{sniperValid.length ? `${((sniperWins / sniperValid.length) * 100).toFixed(0)}%` : "N/D"}</b></div>
        <div className="rounded-lg bg-[var(--surface-2)] p-2"><div className="text-[var(--text-faint)]">PnL virtual</div><b className={`font-data text-lg ${sniperPnlUsd >= 0 ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-risk)]"}`}>{sniperPnlUsd >= 0 ? "+" : ""}${sniperPnlUsd.toFixed(2)}</b></div>
      </div>
      <div className="rounded-xl border border-[var(--accent-gold)]/30 bg-[var(--surface-2)] p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><b className="text-sm">🧪 Execution Audit</b><div className="text-[9px] text-[var(--text-faint)]">Comprueba si el PnL depende de pumps extremos antes de considerar dinero real.</div></div>
          <div className="text-[10px] text-[var(--accent-gold)]">PAPER ONLY</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
          <div><span className="text-[var(--text-faint)]">Trades válidos</span><div className="font-data text-sm font-semibold">{sniperValid.length}</div></div>
          <div><span className="text-[var(--text-faint)]">Mediana / trade</span><div className="font-data text-sm font-semibold">{sniperMedianReturn == null ? "N/D" : pctText(sniperMedianReturn)}</div></div>
          <div><span className="text-[var(--text-faint)]">Profit factor</span><div className="font-data text-sm font-semibold">{profitFactor == null ? "N/D" : profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)}</div></div>
          <div><span className="text-[var(--text-faint)]">Max drawdown</span><div className="font-data text-sm font-semibold">-${maxDrawdownUsd.toFixed(2)}</div></div>
          <div><span className="text-[var(--text-faint)]">Mejor trade</span><div className="font-data text-sm font-semibold text-[var(--accent-opportunity)]">{bestTrade ? `${bestTrade.symbol} ${pctText(bestTrade.netReturnPct)}` : "N/D"}</div></div>
          <div><span className="text-[var(--text-faint)]">Peor trade</span><div className="font-data text-sm font-semibold text-[var(--accent-risk)]">{worstTrade ? `${worstTrade.symbol} ${pctText(worstTrade.netReturnPct)}` : "N/D"}</div></div>
          <div><span className="text-[var(--text-faint)]">PnL sin top 1%</span><div className={`font-data text-sm font-semibold ${pnlWithoutTop1Pct >= 0 ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-risk)]"}`}>{pnlWithoutTop1Pct >= 0 ? "+" : ""}${pnlWithoutTop1Pct.toFixed(2)}</div></div>
          <div><span className="text-[var(--text-faint)]">Mejor trade / PnL</span><div className="font-data text-sm font-semibold">{topTradeShare == null ? "N/D" : `${topTradeShare.toFixed(0)}%`}</div></div>
        </div>
        <div className="text-[9px] text-[var(--text-muted)]">Si “PnL sin top 1%” se derrumba o el mejor trade explica gran parte del beneficio, el resultado todavía depende demasiado de outliers. Esto sigue usando precios observados, no garantiza ejecución real.</div>
      </div>
      <div className="text-[10px] text-[var(--text-muted)]">Salida dinámica: hard stop −12%; trailing de ~6–12% desde el máximo; reversión; sell pressure cuando hay stream de trades; no-momentum; máximo 90s. Si aparece “PumpPortal fallback”, el bot reintenta PumpDev para trades y usa DexScreener como último respaldo. Una operación necesita ≥3 cotizaciones posteriores, ≥2 niveles de precio distintos y separación temporal real para ser VÁLIDA. Si no, acaba en NO DATA y no toca PnL/win rate. El 3% de fricción solo se descuenta a resultados válidos.</div>
      {sniperOpen.length > 0 && <div className="grid lg:grid-cols-2 gap-2">{sniperOpen.map((p) => <div key={p.mint} className="rounded-xl border border-[var(--accent-info)]/30 bg-[var(--surface-2)] p-3">
        <div className="flex justify-between gap-2"><div><b>{p.name}</b> <span className="text-[var(--text-muted)]">${p.symbol}</span><div className="text-[9px] text-[var(--text-faint)]">PAPER · {Math.max(0, Math.floor((clock - p.openedAt)/1000))}s · {!hasValidPaperData(p) ? `validando datos ${Math.min(p.observedPriceTicks ?? 0, MIN_VALID_PRICE_TICKS)}/${MIN_VALID_PRICE_TICKS}…` : `${p.tradeCount} updates válidos`}</div></div><div className={`font-data font-bold ${p.netReturnPct >= 0 ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-risk)]"}`}>{!hasValidPaperData(p) ? "WAIT" : pctText(p.grossReturnPct)}</div></div>
        <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]"><div>Peak <b className="text-[var(--accent-opportunity)]">{pctText(p.peakReturnPct)}</b></div><div>From peak <b className={p.drawdownFromPeakPct < 0 ? "text-[var(--accent-risk)]" : ""}>{pctText(p.drawdownFromPeakPct)}</b></div><div>B/S <b>{p.buys}/{p.sells}</b></div></div>
        <button onClick={() => closePaper(p.mint, "manual")} className="mt-2 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-muted)]">Cerrar paper ahora</button>
      </div>)}</div>}
      {sniperClosed.length > 0 && <details><summary className="cursor-pointer text-xs text-[var(--text-muted)]">Últimas salidas ({Math.min(sniperClosed.length, 20)})</summary><div className="mt-2 space-y-1">{sniperClosed.slice(0,20).map((p) => <div key={`${p.mint}-${p.openedAt}`} className="flex flex-wrap justify-between gap-2 rounded bg-[var(--surface-2)] px-2 py-1.5 text-[10px]"><span><b>${p.symbol}</b> · {sniperExitLabel(p.exitReason)} · entry MC {p.entryMarketCapSol.toFixed(3)} SOL → exit MC {p.currentMarketCapSol.toFixed(3)} SOL · peak {pctText(p.peakReturnPct)} · {p.observedPriceTicks} quotes</span><span className="flex gap-2"><b className={p.exitReason === "no_data" ? "text-[var(--text-muted)]" : p.netReturnPct >= 0 ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-risk)]"}>{p.exitReason === "no_data" ? "N/D" : pctText(p.netReturnPct)}</b>{p.exitReason !== "no_data" && <b className={paperTradePnlUsd(p) >= 0 ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-risk)]"}>{paperTradePnlUsd(p) >= 0 ? "+" : ""}${paperTradePnlUsd(p).toFixed(2)}</b>}</span></div>)}</div></details>}
    </div>

    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-display text-sm font-semibold">⚡ DIRECT LAUNCH STREAM · 0–5 MIN</h3><p className="text-[10px] text-[var(--text-faint)]">Aparecen al crearse; no esperamos a DexScreener.</p></div>
        <div className="text-right text-xs text-[var(--text-muted)]">Stream: <b className={streamState === "live" ? "text-[var(--accent-opportunity)]" : streamState === "offline" ? "text-[var(--accent-risk)]" : "text-[var(--accent-gold)]"}>{streamState === "live" ? "LIVE" : streamState === "offline" ? "OFFLINE" : "CONECTANDO"}</b>{streamSource ? <> · <b>{streamSource === "pumpdev" ? "PumpDev" : "PumpPortal fallback"}</b></> : null}{streamSource === "pumpportal" ? <> · trades: <b className={tradeStreamState === "live" ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-gold)]"}>{tradeStreamState === "live" ? "PumpDev LIVE" : "Dex fallback"}</b></> : null} · <b>{instant.length}</b> lanzamientos{streamError ? <div className="mt-0.5 max-w-md text-[9px] text-[var(--accent-risk)]">{streamError}</div> : null}</div>
      </div>
      {instant.length ? <div className="grid lg:grid-cols-2 gap-3">{instant.map((token) => <InstantCard key={token.mint} token={token} now={clock} paperOpen={sniperOpen.some((p) => p.mint === token.mint)} />)}</div> : <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-[var(--text-muted)]">{streamState === "live" ? "Stream conectado. Esperando el próximo token de Pump.fun…" : "Conectando al stream directo de nuevos tokens…"}</div>}
    </div>
    <div className="border-t border-[var(--border)] pt-4"><div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">DexScreener enrichment · cuando el par ya está indexado</div></div>
    {loading && !feed ? <div className="text-sm text-[var(--text-muted)]">Buscando lanzamientos…</div> : groups.map(([title, list]) => <div key={title} className="space-y-2"><div className="flex justify-between"><h3 className="font-display text-sm font-semibold">{title}</h3><span className="text-xs text-[var(--text-muted)]">{list.length}</span></div>{list.length ? <div className="grid lg:grid-cols-2 gap-3">{list.map(c => <LaunchCard key={c.tokenKey} c={c} />)}</div> : <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-xs text-[var(--text-muted)]">No hay ningún par confirmado por DexScreener en esta franja de edad ahora mismo. No es un filtro de volumen/liquidez: si existe un par ≤5m que nuestros feeds descubren, debería aparecer aquí.</div>}</div>)}
    <div className="text-[10px] text-[var(--text-faint)]">V26.1: Direct Launch Stream + Paper Sniper + REAL CORE autónomo. Paper sigue siendo simulado; REAL usa la wallet experimental únicamente cuando REAL TEST está ARMED. El estado real se reconcilia con Solana y una posición invendible queda QUARANTINED en vez de bloquear el runner indefinidamente.</div>
  </section>;
}
