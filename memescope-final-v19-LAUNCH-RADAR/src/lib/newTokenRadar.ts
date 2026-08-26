import { cacheGet, cacheSet, withCoalescing } from "./cache";
import { resolveCoinGeckoByContract } from "./coingecko";
import { Chain } from "./types";
import { getStorage, RadarCandidateState, SecurityAssessment } from "./storage";
import { syncTradingLab } from "./tradingLab";
import { assessSolanaTokenSecurity } from "./securityEngine";
import { assessCatalyst, CatalystAssessment } from "./catalystEngine";

const BASE = "https://api.dexscreener.com";
const CACHE_KEY = "new-token-radar:v5-launch";
const CACHE_TTL_MS = 12_000;
const RADAR_TTL_SECONDS = 8 * 24 * 60 * 60;
const RECENT_DETECTION_WINDOW_MS = 48 * 60 * 60_000;
const RADAR_STALE_AFTER_MS = 15 * 60_000;
const MAX_PAIR_AGE_MINUTES = 7 * 24 * 60;
const MAX_COINGECKO_CHECKS_PER_REFRESH = 4;
const COINGECKO_RECHECK_MS = 15 * 60_000;
const COINGECKO_ERROR_RECHECK_MS = 30 * 60_000;
const MAX_SECURITY_CHECKS_PER_REFRESH = 2;
const SECURITY_RECHECK_MS = 30 * 60_000;
const SECURITY_CRITICAL_RECHECK_MS = 10 * 60_000;

const SUPPORTED_CHAINS: Record<string, Chain> = {
  solana: "solana",
  ethereum: "ethereum",
  base: "base",
  bsc: "bsc",
};

export type RadarClassification = "explosive" | "breakout" | "emerging" | "mature";
export type RadarSource = "latest_profile" | "boosted" | "both";
export type VisibleRadarSource = "coingecko" | "dexscreener";

interface RawProfile { chainId?: string; tokenAddress?: string }
interface RawBoost { chainId?: string; tokenAddress?: string; amount?: number; totalAmount?: number }
interface RawTokenRef { address?: string; name?: string; symbol?: string }
interface RawPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: RawTokenRef;
  quoteToken?: RawTokenRef;
  priceUsd?: string | null;
  liquidity?: { usd?: number | null };
  volume?: { m5?: number | null; h1?: number | null; h6?: number | null; h24?: number | null };
  txns?: {
    m5?: { buys?: number | null; sells?: number | null };
    h1?: { buys?: number | null; sells?: number | null };
  };
  priceChange?: { m5?: number | null; h1?: number | null; h6?: number | null; h24?: number | null };
  pairCreatedAt?: number | null;
  fdv?: number | null;
  marketCap?: number | null;
}

export interface CoinGeckoHorizonStats {
  sampleSize: number;
  medianReturn: number | null;
  positiveRate: number | null;
}

export interface CoinGeckoListingEffectStats {
  observedTransitions: number;
  note: string;
  return15m: CoinGeckoHorizonStats;
  return1h: CoinGeckoHorizonStats;
  return6h: CoinGeckoHorizonStats;
  return24h: CoinGeckoHorizonStats;
}

export interface ContinuationHorizonStats {
  sampleSize: number;
  medianReturn: number | null;
  positiveRate: number | null;
}

export interface ContinuationStats {
  observedDetections: number;
  note: string;
  return1m: ContinuationHorizonStats;
  return3m: ContinuationHorizonStats;
  return5m: ContinuationHorizonStats;
  return10m: ContinuationHorizonStats;
  return15m: ContinuationHorizonStats;
  return30m: ContinuationHorizonStats;
  return60m: ContinuationHorizonStats;
}

export interface RadarCandidate {
  tokenKey: string;
  chain: Chain;
  address: string;
  name: string;
  symbol: string;
  pairAddress: string | null;
  dexId: string | null;
  pairCreatedAt: string;
  ageMinutes: number;
  firstDetectedAt: string;
  detectedMinutesAgo: number;
  firstDetectedPrice: number | null;
  firstDetectedScore: number | null;
  price: number | null;
  returnSinceDetected: number | null;
  peakPriceSinceDetected: number | null;
  peakReturnSinceDetected: number | null;
  lastSeenAt: string;
  lastQualifiedAt: string | null;
  isLive: boolean;
  currentStatus: "live" | "lost_momentum" | "stale";
  currentStatusReason: string | null;
  liquidityUsd: number | null;
  marketCapOrFdv: number | null;
  marketCapIsFdv: boolean;
  volumeM5: number | null;
  volumeH1: number | null;
  volumeH24: number | null;
  buysM5: number | null;
  sellsM5: number | null;
  buysH1: number | null;
  sellsH1: number | null;
  priceChangeM5: number | null;
  priceChangeH1: number | null;

  /** Anti-inflation proxy built from aggregate DEX data, not individual trades. */
  transactionQualityScore: number | null;
  averageTradeUsdM5: number | null;
  activityInflationRisk: "low" | "medium" | "high" | "critical" | "unknown";
  activityPenalty: number;
  rawEarlyMomentumScore: number | null;
  transactionQualityDetail: string | null;

  continuationScore: number;
  continuationConfidence: "low" | "medium" | "high";
  continuationReasons: string[];
  continuationReturn1m: number | null;
  continuationReturn3m: number | null;
  continuationReturn5m: number | null;
  continuationReturn10m: number | null;
  continuationReturn15m: number | null;
  continuationReturn30m: number | null;
  continuationReturn60m: number | null;
  continuationMfe60m: number | null;
  continuationMae60m: number | null;

  securityAssessment: SecurityAssessment | null;
  catalystAssessment: CatalystAssessment | null;

  source: RadarSource;
  visibleSource: VisibleRadarSource;
  originSource: "dexscreener";
  boosted: boolean;
  boostAmount: number | null;
  earlyMomentumScore: number;
  classification: RadarClassification;
  reasons: string[];
  risks: string[];
  dexUrl: string;

  coingeckoId: string | null;
  coingeckoFirstSeenAt: string | null;
  coingeckoTransitionObservedAt: string | null;
  priceAtCoinGeckoTransition: number | null;
  isPreCoinGecko: boolean;
  coinGeckoStatus: "listed" | "not_listed" | "unknown";
}

export interface RadarFeed {
  /** Só candidatos que passam os gates AGORA. */
  candidates: RadarCandidate[];
  /** Deteções recentes que já não passam os gates, preservadas para acompanhamento. */
  recentCandidates: RadarCandidate[];
  generatedAt: string;
  source: "dexscreener+coingecko";
  status: "live" | "unavailable";
  scannedTokens: number;
  rejectedTokens: number;
  listingEffect: CoinGeckoListingEffectStats;
  continuation: ContinuationStats;
  note: string;
  error?: string;
}

function clamp(v: number, min = 0, max = 100) { return Math.min(max, Math.max(min, v)); }
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function chainOf(raw?: string): Chain | null { return raw ? SUPPORTED_CHAINS[raw.toLowerCase()] ?? null : null; }
function keyOf(chain: Chain, address: string) { return `${chain}:${address.toLowerCase()}`; }
function iso(ms: number) { return new Date(ms).toISOString(); }


interface TransactionQuality {
  score: number | null;
  averageTradeUsd: number | null;
  risk: "low" | "medium" | "high" | "critical" | "unknown";
  penalty: number;
  detail: string | null;
  hardReject: boolean;
}

/**
 * DexScreener's public pair feed exposes aggregate volume + transaction counts,
 * not each trade's USD amount. We therefore use a conservative anti-inflation
 * proxy: average USD turnover per transaction over 5m.
 *
 * This catches patterns such as thousands of txns generating only a few dollars
 * of real volume, without claiming those trades are proven "fake".
 */
function transactionQuality(volumeM5: number | null, tx5: number): TransactionQuality {
  if (volumeM5 === null || volumeM5 < 0 || tx5 <= 0) {
    return {
      score: null,
      averageTradeUsd: null,
      risk: "unknown",
      penalty: 0,
      detail: "Qualidade de transações indisponível: volume/contagem 5m incompletos",
      hardReject: false,
    };
  }

  const avg = volumeM5 / tx5;
  let score: number;
  let risk: TransactionQuality["risk"];
  let penalty: number;
  let hardReject = false;

  if (avg < 0.05) {
    score = 0; risk = "critical"; penalty = 35; hardReject = tx5 >= 30;
  } else if (avg < 0.25) {
    score = 12; risk = "critical"; penalty = 30; hardReject = tx5 >= 60;
  } else if (avg < 1) {
    score = 30; risk = "high"; penalty = 20;
  } else if (avg < 3) {
    score = 50; risk = "medium"; penalty = 12;
  } else if (avg < 10) {
    score = 70; risk = "medium"; penalty = 5;
  } else if (avg < 25) {
    score = 85; risk = "low"; penalty = 0;
  } else {
    score = 100; risk = "low"; penalty = 0;
  }

  // Very high transaction density with low average size is a second warning.
  // We do not call it wash trading because aggregate data cannot prove that.
  if (tx5 >= 500 && avg < 2) {
    penalty = Math.max(penalty, 25);
    risk = avg < 0.5 ? "critical" : "high";
    if (avg < 0.5) hardReject = true;
  }

  return {
    score,
    averageTradeUsd: Math.round(avg * 10000) / 10000,
    risk,
    penalty,
    detail: `${tx5.toLocaleString("en-US")} tx em 5m · volume/tx médio ≈ $${avg < 0.01 ? avg.toFixed(4) : avg.toFixed(2)}`,
    hardReject,
  };
}

function scorePair(
  pair: RawPair,
  source: RadarSource
): {
  score: number;
  rawScore: number;
  classification: RadarClassification | null;
  reasons: string[];
  risks: string[];
  transactionQuality: TransactionQuality;
} {
  const liquidity = num(pair.liquidity?.usd);
  const v5 = num(pair.volume?.m5);
  const v1h = num(pair.volume?.h1);
  const pc5 = num(pair.priceChange?.m5);
  const pc1h = num(pair.priceChange?.h1);
  const buys5 = num(pair.txns?.m5?.buys) ?? 0;
  const sells5 = num(pair.txns?.m5?.sells) ?? 0;
  const tx5 = buys5 + sells5;
  const buys1h = num(pair.txns?.h1?.buys) ?? 0;
  const sells1h = num(pair.txns?.h1?.sells) ?? 0;
  const tx1h = buys1h + sells1h;
  const created = num(pair.pairCreatedAt);
  const tq = transactionQuality(v5, tx5);

  if (!created) return { score: 0, rawScore: 0, classification: null, reasons: [], risks: ["Idade do par indisponível"], transactionQuality: tq };
  const ageMin = Math.max(0, (Date.now() - created) / 60_000);
  const reasons: string[] = [];
  const risks: string[] = [];

  if (ageMin > MAX_PAIR_AGE_MINUTES) {
    return { score: 0, rawScore: 0, classification: null, reasons, risks: ["Par fora da janela de 7 dias do Radar"], transactionQuality: tq };
  }
  if (liquidity === null || liquidity < 10_000) {
    return { score: 0, rawScore: 0, classification: null, reasons, risks: ["Liquidez inferior a $10k"], transactionQuality: tq };
  }

  // Depois de 6h o token pode entrar em DEX Mature mesmo sem estar a explodir
  // exatamente nos últimos 5m. Exigimos atividade sustentada e liquidez real.
  const matureEligible =
    ageMin >= 6 * 60 &&
    liquidity >= 50_000 &&
    (v1h ?? 0) >= 5_000 &&
    tx1h >= 20;

  // Para descoberta realmente precoce mantemos gates mais fortes de 5m.
  if (!matureEligible) {
    if (tx5 < 10) return { score: 0, rawScore: 0, classification: null, reasons, risks: ["Poucas transações nos últimos 5m"], transactionQuality: tq };
    if (v5 === null || v5 < 1_500) return { score: 0, rawScore: 0, classification: null, reasons, risks: ["Volume 5m insuficiente"], transactionQuality: tq };
  }

  let score = 0;
  if (pc5 !== null) {
    score += clamp(((pc5 + 2) / 17) * 28, 0, 28);
    if (pc5 >= 5) reasons.push(`Preço +${pc5.toFixed(1)}% em 5m`);
    if (pc5 > 80) risks.push("Movimento 5m extremo — risco elevado de entrada tardia/reversão");
  }
  if (pc1h !== null) {
    score += clamp(((pc1h + 5) / 55) * 10, 0, 10);
    if (pc1h >= 20) reasons.push(`Preço +${pc1h.toFixed(1)}% em 1h`);
  }

  const turnover5 = liquidity > 0 && v5 !== null ? v5 / liquidity : 0;
  score += clamp((turnover5 / 0.55) * 24, 0, 24);
  if (turnover5 >= 0.2) reasons.push(`Volume 5m equivale a ${(turnover5 * 100).toFixed(0)}% da liquidez`);

  const qualityFactor = tq.score === null ? 0.65 : clamp(tq.score / 100, 0.05, 1);
  const txForScore = Math.max(tx5, Math.min(tx1h / 12, 300));
  const txContribution = clamp((Math.log10(Math.max(txForScore, 10) / 10 + 1) / Math.log10(11)) * 13, 0, 13);
  score += txContribution * qualityFactor;

  const buyRatio = tx5 > 0 ? buys5 / tx5 : tx1h > 0 ? buys1h / tx1h : 0.5;
  const buyContribution = clamp(((buyRatio - 0.45) / 0.35) * 15, 0, 15);
  score += buyContribution * qualityFactor;
  if (tx5 >= 20 && buyRatio >= 0.62 && qualityFactor >= 0.5) reasons.push(`${(buyRatio * 100).toFixed(0)}% das transações 5m são compras`);

  if (tq.risk === "critical") {
    risks.push(`Atividade potencialmente inflacionada — ${tq.detail}`);
  } else if (tq.risk === "high") {
    risks.push(`Qualidade de atividade baixa — ${tq.detail}`);
  } else if (tq.risk === "medium" && tq.averageTradeUsd !== null && tq.averageTradeUsd < 3) {
    risks.push(`Muitas transações pequenas face ao volume — ${tq.detail}`);
  } else if (tq.risk === "low" && tq.detail) {
    reasons.push(`Atividade com volume/tx plausível — ${tq.detail}`);
  }

  if (ageMin <= 30) score += 10;
  else if (ageMin <= 120) score += 8;
  else if (ageMin <= 360) score += 5;
  else score += 2;

  if (source !== "latest_profile") {
    score += 1;
    risks.push("Token boosted/promovido na DexScreener — promoção paga não é sinal de qualidade");
  }
  if (liquidity < 25_000) risks.push("Liquidez ainda baixa (< $25k)");
  if (ageMin < 10) risks.push("Par extremamente recente (<10 min)");
  if (v1h !== null && v5 !== null && v5 * 12 > v1h * 4) reasons.push("Ritmo de volume 5m muito acima do ritmo da última hora");

  const rawScore = Math.round(clamp(score) * 10) / 10;
  score = Math.round(clamp(rawScore - tq.penalty) * 10) / 10;

  let classification: RadarClassification | null = null;
  if (!tq.hardReject) {
    if (score >= 85 && liquidity >= 25_000 && tx5 >= 30 && (pc5 ?? 0) >= 8 && tq.risk !== "high" && tq.risk !== "critical") classification = "explosive";
    else if (score >= 70 && liquidity >= 15_000 && tx5 >= 20 && (pc5 ?? 0) >= 4 && tq.risk !== "critical") classification = "breakout";
    else if (score >= 55 && (pc5 ?? 0) > 0) classification = "emerging";
    else if (matureEligible && tq.risk !== "critical") {
      classification = "mature";
      reasons.push("DEX Mature: atividade e liquidez sustentadas apesar de já não estar na fase inicial");
    }
  } else {
    risks.unshift("Excluído do Live Radar: atividade agregada incompatível com o número de transações");
  }

  return { score, rawScore, classification, reasons, risks, transactionQuality: tq };
}

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error(`DEX_HTTP_${res.status}`);
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSeeds() {
  const [profilesRes, boostsRes] = await Promise.allSettled([
    fetchJson<RawProfile[]>(`${BASE}/token-profiles/latest/v1`),
    fetchJson<RawBoost[]>(`${BASE}/token-boosts/latest/v1`),
  ]);
  const seeds = new Map<string, { chain: Chain; address: string; source: RadarSource; boostAmount: number | null }>();

  if (profilesRes.status === "fulfilled") {
    for (const p of profilesRes.value ?? []) {
      const chain = chainOf(p.chainId);
      const address = p.tokenAddress?.trim();
      if (!chain || !address) continue;
      seeds.set(keyOf(chain, address), { chain, address, source: "latest_profile", boostAmount: null });
    }
  }
  if (boostsRes.status === "fulfilled") {
    for (const b of boostsRes.value ?? []) {
      const chain = chainOf(b.chainId);
      const address = b.tokenAddress?.trim();
      if (!chain || !address) continue;
      const key = keyOf(chain, address);
      const existing = seeds.get(key);
      seeds.set(key, {
        chain,
        address,
        source: existing ? "both" : "boosted",
        boostAmount: num(b.amount) ?? num(b.totalAmount),
      });
    }
  }
  if (!seeds.size) throw new Error("DEX_DISCOVERY_FEEDS_UNAVAILABLE");
  return seeds;
}

async function fetchPairsForSeeds(
  seeds: Map<string, { chain: Chain; address: string }>
): Promise<Map<string, RawPair>> {
  const byChain = new Map<Chain, string[]>();
  for (const s of seeds.values()) byChain.set(s.chain, [...(byChain.get(s.chain) ?? []), s.address]);

  const output = new Map<string, RawPair>();
  const jobs: Promise<void>[] = [];
  for (const [chain, addresses] of byChain) {
    for (let i = 0; i < addresses.length; i += 25) {
      const batch = addresses.slice(i, i + 25);
      jobs.push((async () => {
        try {
          const pairs = await fetchJson<RawPair[]>(`${BASE}/tokens/v1/${chain}/${batch.join(",")}`);
          for (const pair of pairs ?? []) {
            const base = pair.baseToken?.address;
            if (!base) continue;
            const key = keyOf(chain, base);
            if (!seeds.has(key)) continue;
            const current = output.get(key);
            if (!current || (num(pair.liquidity?.usd) ?? 0) > (num(current.liquidity?.usd) ?? 0)) output.set(key, pair);
          }
        } catch (err) {
          console.warn(`[MemeScope][Radar] batch ${chain} failed:`, err instanceof Error ? err.message : String(err));
        }
      })());
    }
  }
  await Promise.all(jobs);
  return output;
}

function normalizeState(state: RadarCandidateState): RadarCandidateState {
  return {
    ...state,
    volumeH24: state.volumeH24 ?? null,
    buysH1: state.buysH1 ?? null,
    firstDetectedScore: state.firstDetectedScore ?? state.earlyMomentumScore ?? null,
    lastQualifiedAt: state.lastQualifiedAt ?? state.firstDetectedAt,
    peakPriceSinceDetected: state.peakPriceSinceDetected ?? state.price ?? state.firstDetectedPrice ?? null,
    peakReturnSinceDetected: state.peakReturnSinceDetected ?? returnFrom(state.firstDetectedPrice, state.peakPriceSinceDetected ?? state.price ?? null),
    isLive: state.isLive ?? true,
    currentStatus: state.currentStatus ?? "live",
    currentStatusReason: state.currentStatusReason ?? null,
    sellsH1: state.sellsH1 ?? null,
    transactionQualityScore: state.transactionQualityScore ?? null,
    averageTradeUsdM5: state.averageTradeUsdM5 ?? null,
    activityInflationRisk: state.activityInflationRisk ?? "unknown",
    activityPenalty: state.activityPenalty ?? 0,
    rawEarlyMomentumScore: state.rawEarlyMomentumScore ?? state.earlyMomentumScore ?? null,
    transactionQualityDetail: state.transactionQualityDetail ?? null,
    continuationPrice1m: state.continuationPrice1m ?? null,
    continuationPrice3m: state.continuationPrice3m ?? null,
    continuationPrice5m: state.continuationPrice5m ?? null,
    continuationPrice10m: state.continuationPrice10m ?? null,
    continuationPrice15m: state.continuationPrice15m ?? null,
    continuationPrice30m: state.continuationPrice30m ?? null,
    continuationPrice60m: state.continuationPrice60m ?? null,
    continuationReturn1m: state.continuationReturn1m ?? null,
    continuationReturn3m: state.continuationReturn3m ?? null,
    continuationReturn5m: state.continuationReturn5m ?? null,
    continuationReturn10m: state.continuationReturn10m ?? null,
    continuationReturn15m: state.continuationReturn15m ?? null,
    continuationReturn30m: state.continuationReturn30m ?? null,
    continuationReturn60m: state.continuationReturn60m ?? null,
    continuationMfe60m: state.continuationMfe60m ?? null,
    continuationMae60m: state.continuationMae60m ?? null,
    securityAssessment: state.securityAssessment ?? null,
    catalystAssessment: null,
    nextSecurityCheckAt: state.nextSecurityCheckAt ?? null,
    coingeckoId: state.coingeckoId ?? null,
    coingeckoFirstSeenAt: state.coingeckoFirstSeenAt ?? null,
    coingeckoPreviouslyNotListed: state.coingeckoPreviouslyNotListed ?? false,
    coingeckoTransitionObservedAt: state.coingeckoTransitionObservedAt ?? null,
    priceAtCoinGeckoTransition: state.priceAtCoinGeckoTransition ?? null,
    nextCoinGeckoCheckAt: state.nextCoinGeckoCheckAt ?? null,
    coingeckoReturn15m: state.coingeckoReturn15m ?? null,
    coingeckoReturn1h: state.coingeckoReturn1h ?? null,
    coingeckoReturn6h: state.coingeckoReturn6h ?? null,
    coingeckoReturn24h: state.coingeckoReturn24h ?? null,
  };
}

function returnFrom(base: number | null, price: number | null): number | null {
  if (base === null || price === null || base <= 0) return null;
  return Math.round((((price - base) / base) * 100) * 100) / 100;
}


type ContinuationPriceKey =
  | "continuationPrice1m" | "continuationPrice3m" | "continuationPrice5m"
  | "continuationPrice10m" | "continuationPrice15m" | "continuationPrice30m" | "continuationPrice60m";
type ContinuationReturnKey =
  | "continuationReturn1m" | "continuationReturn3m" | "continuationReturn5m"
  | "continuationReturn10m" | "continuationReturn15m" | "continuationReturn30m" | "continuationReturn60m";

const CONTINUATION_HORIZONS: Array<{
  minMs: number;
  maxMs: number;
  priceKey: ContinuationPriceKey;
  returnKey: ContinuationReturnKey;
}> = [
  { minMs: 30_000, maxMs: 110_000, priceKey: "continuationPrice1m", returnKey: "continuationReturn1m" },
  { minMs: 2 * 60_000, maxMs: 4.5 * 60_000, priceKey: "continuationPrice3m", returnKey: "continuationReturn3m" },
  { minMs: 4 * 60_000, maxMs: 6.5 * 60_000, priceKey: "continuationPrice5m", returnKey: "continuationReturn5m" },
  { minMs: 8.5 * 60_000, maxMs: 12 * 60_000, priceKey: "continuationPrice10m", returnKey: "continuationReturn10m" },
  { minMs: 13 * 60_000, maxMs: 18 * 60_000, priceKey: "continuationPrice15m", returnKey: "continuationReturn15m" },
  { minMs: 27 * 60_000, maxMs: 34 * 60_000, priceKey: "continuationPrice30m", returnKey: "continuationReturn30m" },
  { minMs: 55 * 60_000, maxMs: 68 * 60_000, priceKey: "continuationPrice60m", returnKey: "continuationReturn60m" },
];

function updateContinuationOutcomes(stateRaw: RadarCandidateState, now: number): RadarCandidateState {
  const state = normalizeState(stateRaw);
  if (state.firstDetectedPrice === null || state.firstDetectedPrice <= 0 || state.price === null || state.price <= 0) return state;
  const detectedAt = new Date(state.firstDetectedAt).getTime();
  if (!Number.isFinite(detectedAt)) return state;
  const elapsed = now - detectedAt;
  if (elapsed < 0) return state;

  const next: RadarCandidateState = { ...state };
  const bag = next as unknown as Record<string, number | null | undefined>;

  for (const h of CONTINUATION_HORIZONS) {
    if (bag[h.priceKey] == null && elapsed >= h.minMs && elapsed <= h.maxMs) {
      bag[h.priceKey] = state.price;
      bag[h.returnKey] = returnFrom(state.firstDetectedPrice, state.price);
    }
  }

  if (elapsed <= 68 * 60_000) {
    const currentReturn = returnFrom(state.firstDetectedPrice, state.price);
    if (currentReturn !== null) {
      next.continuationMfe60m = Math.max(next.continuationMfe60m ?? -Infinity, currentReturn);
      next.continuationMae60m = Math.min(next.continuationMae60m ?? Infinity, currentReturn);
    }
  }
  return next;
}

function continuationHeuristic(
  state: RadarCandidateState,
  empirical5m: ContinuationHorizonStats | null
): { score: number; confidence: "low" | "medium" | "high"; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  score += clamp(state.earlyMomentumScore ?? 0) * 0.35;

  const quality = state.transactionQualityScore ?? 50;
  score += quality * 0.20;
  if (quality >= 80) reasons.push("atividade/transações com boa qualidade");
  else if (quality < 40) reasons.push("qualidade de atividade fraca");

  const tx = (state.buysM5 ?? 0) + (state.sellsM5 ?? 0);
  const buyRatio = tx > 0 ? (state.buysM5 ?? 0) / tx : 0.5;
  score += clamp(((buyRatio - 0.45) / 0.30) * 100) * 0.15;
  if (tx >= 20 && buyRatio >= 0.62) reasons.push("pressão compradora acima da média");

  const v5 = state.volumeM5 ?? 0;
  const v1h = state.volumeH1 ?? 0;
  const accel = v5 > 0 && v1h > 0 ? (v5 * 12) / v1h : null;
  if (accel !== null) {
    score += clamp((accel / 3) * 100) * 0.15;
    if (accel >= 1.6) reasons.push("ritmo de volume 5m acelerado");
  } else {
    score += 45 * 0.15;
  }

  const liquidity = state.liquidityUsd ?? 0;
  score += clamp(((Math.log10(Math.max(liquidity, 1)) - 4) / 1.5) * 100) * 0.10;

  const pc5 = state.priceChangeM5 ?? 0;
  let priceComponent = clamp(((pc5 + 2) / 22) * 100);
  if (pc5 > 60) {
    priceComponent *= 0.55;
    reasons.push("movimento 5m já muito esticado");
  } else if (pc5 >= 5 && pc5 <= 35) {
    reasons.push("momentum 5m forte sem estar tão esticado");
  }
  score += priceComponent * 0.05;

  if (empirical5m && empirical5m.sampleSize >= 20 && empirical5m.positiveRate !== null) {
    const empirical = clamp(
      empirical5m.positiveRate * 0.75 +
      clamp((((empirical5m.medianReturn ?? 0) + 10) / 30) * 100) * 0.25
    );
    score = score * 0.75 + empirical * 0.25;
    reasons.push(`backtest +5m disponível (n=${empirical5m.sampleSize})`);
  }

  if (state.activityInflationRisk === "critical") score -= 30;
  else if (state.activityInflationRisk === "high") score -= 18;
  if ((state.liquidityUsd ?? 0) < 25_000) score -= 8;
  if ((state.priceChangeM5 ?? 0) < 0) score -= 15;

  score = Math.round(clamp(score) * 10) / 10;
  const n = empirical5m?.sampleSize ?? 0;
  const confidence: "low" | "medium" | "high" = n >= 100 ? "high" : n >= 30 ? "medium" : "low";
  return { score, confidence, reasons: reasons.slice(0, 4) };
}

function updateCoinGeckoOutcomes(state: RadarCandidateState, now: number): RadarCandidateState {
  if (!state.coingeckoTransitionObservedAt || state.priceAtCoinGeckoTransition === null || state.price === null) return state;
  const elapsed = now - new Date(state.coingeckoTransitionObservedAt).getTime();
  const next = { ...state };
  const r = returnFrom(state.priceAtCoinGeckoTransition, state.price);
  if (r === null) return state;

  // Só registamos o primeiro snapshot dentro de uma tolerância razoável. Se o
  // monitor esteve parado durante horas, preferimos N/D a falsear +15m/+1h.
  if (next.coingeckoReturn15m === null && elapsed >= 15 * 60_000 && elapsed <= 25 * 60_000) next.coingeckoReturn15m = r;
  if (next.coingeckoReturn1h === null && elapsed >= 60 * 60_000 && elapsed <= 80 * 60_000) next.coingeckoReturn1h = r;
  if (next.coingeckoReturn6h === null && elapsed >= 6 * 60 * 60_000 && elapsed <= 7 * 60 * 60_000) next.coingeckoReturn6h = r;
  if (next.coingeckoReturn24h === null && elapsed >= 24 * 60 * 60_000 && elapsed <= 26 * 60 * 60_000) next.coingeckoReturn24h = r;
  return next;
}

async function enrichCoinGecko(states: RadarCandidateState[], now: number): Promise<RadarCandidateState[]> {
  const updated = states.map((s) => normalizeState(s));
  const due = updated
    .filter((s) => !s.coingeckoId && (!s.nextCoinGeckoCheckAt || new Date(s.nextCoinGeckoCheckAt).getTime() <= now))
    .sort((a, b) => {
      if (a.coingeckoPreviouslyNotListed !== b.coingeckoPreviouslyNotListed) return a.coingeckoPreviouslyNotListed ? -1 : 1;
      if (a.classification === "mature" && b.classification !== "mature") return -1;
      if (b.classification === "mature" && a.classification !== "mature") return 1;
      return b.earlyMomentumScore - a.earlyMomentumScore;
    })
    .slice(0, MAX_COINGECKO_CHECKS_PER_REFRESH);

  const results = await Promise.all(due.map(async (state) => ({
    tokenKey: state.tokenKey,
    result: await resolveCoinGeckoByContract(state.chain, state.address),
  })));
  const byKey = new Map(results.map((r) => [r.tokenKey, r.result]));

  return updated.map((state) => {
    const result = byKey.get(state.tokenKey);
    let next = state;
    if (result?.status === "listed" && result.match) {
      const transitionObservedAt = state.coingeckoTransitionObservedAt ?? (state.coingeckoPreviouslyNotListed ? iso(now) : null);
      next = {
        ...state,
        coingeckoId: result.match.id,
        coingeckoFirstSeenAt: state.coingeckoFirstSeenAt ?? iso(now),
        coingeckoTransitionObservedAt: transitionObservedAt,
        priceAtCoinGeckoTransition: state.priceAtCoinGeckoTransition ?? (transitionObservedAt ? state.price : null),
        nextCoinGeckoCheckAt: null,
      };
      if (transitionObservedAt && !state.coingeckoTransitionObservedAt) {
        next.reasons = [...state.reasons, "MemeScope observou a transição DEX-only → CoinGecko"];
      }
    } else if (result?.status === "not_listed") {
      next = {
        ...state,
        coingeckoPreviouslyNotListed: true,
        nextCoinGeckoCheckAt: iso(now + COINGECKO_RECHECK_MS),
      };
    } else if (result?.status === "unavailable") {
      next = { ...state, nextCoinGeckoCheckAt: iso(now + COINGECKO_ERROR_RECHECK_MS) };
    }
    return updateCoinGeckoOutcomes(next, now);
  });
}

async function enrichSecurity(states: RadarCandidateState[], now: number): Promise<RadarCandidateState[]> {
  const normalized=states.map(normalizeState);
  const due=normalized
    .filter(s=>s.chain==="solana" && (!s.nextSecurityCheckAt || new Date(s.nextSecurityCheckAt).getTime()<=now))
    .sort((a,b)=>Number(Boolean(b.isLive))-Number(Boolean(a.isLive)) || b.earlyMomentumScore-a.earlyMomentumScore)
    .slice(0,MAX_SECURITY_CHECKS_PER_REFRESH);
  const results=await Promise.all(due.map(async s=>({key:s.tokenKey, assessment:await assessSolanaTokenSecurity(s.address)})));
  const map=new Map(results.map(x=>[x.key,x.assessment]));
  return normalized.map(state=>{
    const assessment=map.get(state.tokenKey) ?? state.securityAssessment ?? null;
    if(!assessment) return state;
    const checkedNow=map.has(state.tokenKey);
    const next={...state,securityAssessment:assessment,nextSecurityCheckAt:checkedNow?iso(now+(assessment.critical?SECURITY_CRITICAL_RECHECK_MS:SECURITY_RECHECK_MS)):state.nextSecurityCheckAt};
    if(assessment.critical){
      next.isLive=false;
      next.currentStatus="lost_momentum";
      next.currentStatusReason=`Security Gate: ${assessment.blockers[0] ?? "risco crítico"}`;
      next.risks=Array.from(new Set([`⛔ Security Gate: ${assessment.blockers.join(" · ")}`,...next.risks])).slice(0,7);
    } else if(assessment.risk==="high"){
      next.risks=Array.from(new Set([`🛡️ Security Risk HIGH (${assessment.score ?? "N/D"}/100)`,...assessment.warnings,...next.risks])).slice(0,7);
    }
    return next;
  });
}

function materialize(
  stateRaw: RadarCandidateState,
  now = Date.now(),
  empirical5m: ContinuationHorizonStats | null = null
): RadarCandidate {
  const state = normalizeState(stateRaw);
  const continuation = continuationHeuristic(state, empirical5m);
  const cgKnown = Boolean(state.coingeckoId);
  const cgCheckedNotListed = state.coingeckoPreviouslyNotListed && !cgKnown;
  const lastSeenMs = new Date(state.lastSeenAt).getTime();
  const stale = !Number.isFinite(lastSeenMs) || now - lastSeenMs > RADAR_STALE_AFTER_MS;
  const currentStatus: "live" | "lost_momentum" | "stale" = stale ? "stale" : state.isLive ? "live" : "lost_momentum";
  return {
    ...state,
    ageMinutes: Math.max(0, (now - new Date(state.pairCreatedAt).getTime()) / 60_000),
    detectedMinutesAgo: Math.max(0, (now - new Date(state.firstDetectedAt).getTime()) / 60_000),
    firstDetectedScore: state.firstDetectedScore ?? null,
    returnSinceDetected: returnFrom(state.firstDetectedPrice, state.price),
    peakPriceSinceDetected: state.peakPriceSinceDetected ?? null,
    peakReturnSinceDetected: state.peakReturnSinceDetected ?? returnFrom(state.firstDetectedPrice, state.peakPriceSinceDetected ?? null),
    lastQualifiedAt: state.lastQualifiedAt ?? null,
    isLive: currentStatus === "live",
    currentStatus,
    currentStatusReason: stale ? "Dados do Radar desatualizados" : state.currentStatusReason ?? null,
    transactionQualityScore: state.transactionQualityScore ?? null,
    averageTradeUsdM5: state.averageTradeUsdM5 ?? null,
    activityInflationRisk: state.activityInflationRisk ?? "unknown",
    activityPenalty: state.activityPenalty ?? 0,
    rawEarlyMomentumScore: state.rawEarlyMomentumScore ?? state.earlyMomentumScore ?? null,
    transactionQualityDetail: state.transactionQualityDetail ?? null,
    continuationScore: continuation.score,
    continuationConfidence: continuation.confidence,
    continuationReasons: continuation.reasons,
    continuationReturn1m: state.continuationReturn1m ?? null,
    continuationReturn3m: state.continuationReturn3m ?? null,
    continuationReturn5m: state.continuationReturn5m ?? null,
    continuationReturn10m: state.continuationReturn10m ?? null,
    continuationReturn15m: state.continuationReturn15m ?? null,
    continuationReturn30m: state.continuationReturn30m ?? null,
    continuationReturn60m: state.continuationReturn60m ?? null,
    continuationMfe60m: state.continuationMfe60m ?? null,
    continuationMae60m: state.continuationMae60m ?? null,
    securityAssessment: state.securityAssessment ?? null,
    boosted: state.source !== "latest_profile",
    dexUrl: `https://dexscreener.com/${state.chain}/${state.pairAddress ?? state.address}`,
    visibleSource: cgKnown ? "coingecko" : "dexscreener",
    originSource: "dexscreener",
    isPreCoinGecko: cgCheckedNotListed,
    coinGeckoStatus: cgKnown ? "listed" : cgCheckedNotListed ? "not_listed" : "unknown",
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function horizonStats(values: Array<number | null>): CoinGeckoHorizonStats {
  const real = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return {
    sampleSize: real.length,
    medianReturn: median(real),
    positiveRate: real.length ? Math.round((real.filter((v) => v > 0).length / real.length) * 1000) / 10 : null,
  };
}


function continuationStats(statesRaw: RadarCandidateState[]): ContinuationStats {
  const states = statesRaw.map(normalizeState);
  return {
    observedDetections: states.length,
    note: "Mede resultados desde a primeira deteção; horizons perdidos pelo monitor ficam N/D.",
    return1m: horizonStats(states.map((s) => s.continuationReturn1m ?? null)),
    return3m: horizonStats(states.map((s) => s.continuationReturn3m ?? null)),
    return5m: horizonStats(states.map((s) => s.continuationReturn5m ?? null)),
    return10m: horizonStats(states.map((s) => s.continuationReturn10m ?? null)),
    return15m: horizonStats(states.map((s) => s.continuationReturn15m ?? null)),
    return30m: horizonStats(states.map((s) => s.continuationReturn30m ?? null)),
    return60m: horizonStats(states.map((s) => s.continuationReturn60m ?? null)),
  };
}

function listingEffectStats(statesRaw: RadarCandidateState[]): CoinGeckoListingEffectStats {
  const states = statesRaw.map(normalizeState).filter((s) => Boolean(s.coingeckoTransitionObservedAt));
  return {
    observedTransitions: states.length,
    note: "Mede transições que a MemeScope observou diretamente de DEX-only para CoinGecko; não assume uma data oficial de listing.",
    return15m: horizonStats(states.map((s) => s.coingeckoReturn15m)),
    return1h: horizonStats(states.map((s) => s.coingeckoReturn1h)),
    return6h: horizonStats(states.map((s) => s.coingeckoReturn6h)),
    return24h: horizonStats(states.map((s) => s.coingeckoReturn24h)),
  };
}

export async function refreshNewTokenRadar(): Promise<RadarFeed> {
  const storage = getStorage();
  try {
    const existing = (await storage.listRadarCandidates()).map(normalizeState);
    const existingByKey = new Map(existing.map((c) => [c.tokenKey, c]));
    const freshSeeds = await fetchSeeds();

    // Mantemos candidatos já descobertos no scan durante até 7 dias. Isto cria
    // a camada DEX Mature e permite observar uma futura aparição na CoinGecko.
    const scanSeeds = new Map(freshSeeds);
    for (const previous of existing
      .filter((s) => Date.now() - new Date(s.pairCreatedAt).getTime() <= MAX_PAIR_AGE_MINUTES * 60_000)
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
      .slice(0, 40)) {
      if (!scanSeeds.has(previous.tokenKey)) {
        scanSeeds.set(previous.tokenKey, {
          chain: previous.chain,
          address: previous.address,
          source: previous.source,
          boostAmount: previous.boostAmount,
        });
      }
    }

    const pairs = await fetchPairsForSeeds(scanSeeds);
    const now = Date.now();
    let rejected = 0;
    const states: RadarCandidateState[] = [];

    for (const [key, seed] of scanSeeds) {
      const pair = pairs.get(key);
      const prior = existingByKey.get(key);
      if (!pair?.pairCreatedAt) { rejected++; continue; }

      const scored = scorePair(pair, seed.source);
      const pairAgeMinutes = Math.max(0, (now - pair.pairCreatedAt) / 60_000);
      const launchTx5 = (num(pair.txns?.m5?.buys) ?? 0) + (num(pair.txns?.m5?.sells) ?? 0);
      const launchLiquidity = num(pair.liquidity?.usd) ?? 0;
      const launchVolume = num(pair.volume?.m5) ?? 0;
      // V19: during the first five minutes we deliberately do NOT wait for the old
      // momentum gates. The point is to observe acceleration before confirmation.
      const launchEligible = pairAgeMinutes <= 5 && launchLiquidity >= 3_000 && launchTx5 >= 2 && launchVolume >= 100;
      const qualifiesNow = Boolean(scored.classification) || launchEligible;
      if (!qualifiesNow && !prior) { rejected++; continue; }
      if (!qualifiesNow) rejected++;

      const price = pair.priceUsd ? Number(pair.priceUsd) : null;
      const firstDetectedAt = prior?.firstDetectedAt ?? iso(now);
      const firstDetectedPrice = prior?.firstDetectedPrice ?? price;
      const firstDetectedScore = prior?.firstDetectedScore ?? (qualifiesNow ? scored.score : null);
      const marketCap = num(pair.marketCap);
      const fdv = num(pair.fdv);
      const priorPeak = prior?.peakPriceSinceDetected ?? prior?.price ?? prior?.firstDetectedPrice ?? null;
      const peakPrice = price !== null && (priorPeak === null || price > priorPeak) ? price : priorPeak;
      const peakReturn = returnFrom(firstDetectedPrice, peakPrice);
      const classification = scored.classification ?? (launchEligible ? "emerging" : prior?.classification);
      if (!classification) continue;

      const rejectionReason = !qualifiesNow
        ? (scored.risks[0] ?? "Já não passa os gates atuais de momentum/atividade")
        : null;

      const state = normalizeState({
        tokenKey: key,
        chain: seed.chain,
        address: seed.address,
        name: pair.baseToken?.name ?? prior?.name ?? pair.baseToken?.symbol ?? "Token",
        symbol: pair.baseToken?.symbol ?? prior?.symbol ?? "TOKEN",
        pairAddress: pair.pairAddress ?? prior?.pairAddress ?? null,
        dexId: pair.dexId ?? prior?.dexId ?? null,
        pairCreatedAt: new Date(pair.pairCreatedAt).toISOString(),
        firstDetectedAt,
        firstDetectedPrice,
        firstDetectedScore,
        lastSeenAt: iso(now),
        lastQualifiedAt: qualifiesNow ? iso(now) : prior?.lastQualifiedAt ?? prior?.firstDetectedAt ?? null,
        price,
        peakPriceSinceDetected: peakPrice,
        peakReturnSinceDetected: peakReturn,
        liquidityUsd: num(pair.liquidity?.usd),
        marketCapOrFdv: marketCap ?? fdv,
        marketCapIsFdv: marketCap === null && fdv !== null,
        volumeM5: num(pair.volume?.m5),
        volumeH1: num(pair.volume?.h1),
        volumeH24: num(pair.volume?.h24),
        buysM5: num(pair.txns?.m5?.buys),
        sellsM5: num(pair.txns?.m5?.sells),
        buysH1: num(pair.txns?.h1?.buys),
        sellsH1: num(pair.txns?.h1?.sells),
        priceChangeM5: num(pair.priceChange?.m5),
        priceChangeH1: num(pair.priceChange?.h1),
        transactionQualityScore: scored.transactionQuality.score,
        averageTradeUsdM5: scored.transactionQuality.averageTradeUsd,
        activityInflationRisk: scored.transactionQuality.risk,
        activityPenalty: scored.transactionQuality.penalty,
        rawEarlyMomentumScore: scored.rawScore,
        transactionQualityDetail: scored.transactionQuality.detail,
        continuationPrice1m: prior?.continuationPrice1m ?? null,
        continuationPrice3m: prior?.continuationPrice3m ?? null,
        continuationPrice5m: prior?.continuationPrice5m ?? null,
        continuationPrice10m: prior?.continuationPrice10m ?? null,
        continuationPrice15m: prior?.continuationPrice15m ?? null,
        continuationPrice30m: prior?.continuationPrice30m ?? null,
        continuationPrice60m: prior?.continuationPrice60m ?? null,
        continuationReturn1m: prior?.continuationReturn1m ?? null,
        continuationReturn3m: prior?.continuationReturn3m ?? null,
        continuationReturn5m: prior?.continuationReturn5m ?? null,
        continuationReturn10m: prior?.continuationReturn10m ?? null,
        continuationReturn15m: prior?.continuationReturn15m ?? null,
        continuationReturn30m: prior?.continuationReturn30m ?? null,
        continuationReturn60m: prior?.continuationReturn60m ?? null,
        continuationMfe60m: prior?.continuationMfe60m ?? null,
        continuationMae60m: prior?.continuationMae60m ?? null,
        securityAssessment: prior?.securityAssessment ?? null,
        nextSecurityCheckAt: prior?.nextSecurityCheckAt ?? null,
        source: seed.source,
        boostAmount: seed.boostAmount,
        earlyMomentumScore: scored.score,
        classification,
        isLive: qualifiesNow,
        currentStatus: qualifiesNow ? "live" : "lost_momentum",
        currentStatusReason: rejectionReason,
        reasons: qualifiesNow ? (launchEligible && !scored.classification ? ["V19 Launch Radar: par <5 min observado antes da confirmação de momentum", ...scored.reasons] : scored.reasons) : prior?.reasons ?? scored.reasons,
        risks: qualifiesNow ? scored.risks : Array.from(new Set([...(prior?.risks ?? []), ...scored.risks])).slice(0, 5),
        coingeckoId: prior?.coingeckoId ?? null,
        coingeckoFirstSeenAt: prior?.coingeckoFirstSeenAt ?? null,
        coingeckoPreviouslyNotListed: prior?.coingeckoPreviouslyNotListed ?? false,
        coingeckoTransitionObservedAt: prior?.coingeckoTransitionObservedAt ?? null,
        priceAtCoinGeckoTransition: prior?.priceAtCoinGeckoTransition ?? null,
        nextCoinGeckoCheckAt: prior?.nextCoinGeckoCheckAt ?? null,
        coingeckoReturn15m: prior?.coingeckoReturn15m ?? null,
        coingeckoReturn1h: prior?.coingeckoReturn1h ?? null,
        coingeckoReturn6h: prior?.coingeckoReturn6h ?? null,
        coingeckoReturn24h: prior?.coingeckoReturn24h ?? null,
      });
      states.push(updateContinuationOutcomes(state, now));
    }

    const coinGeckoEnriched = await enrichCoinGecko(states, now);
    const enriched = await enrichSecurity(coinGeckoEnriched, now);
    for (const state of enriched) await storage.setRadarCandidate(state, RADAR_TTL_SECONDS);

    const allStored = (await storage.listRadarCandidates()).map(normalizeState);
    const contStats = continuationStats(allStored);
    const materializedAll = allStored.map((state) => materialize(state, now, contStats.return5m));
    const candidates = materializedAll
      .filter((candidate) => candidate.currentStatus === "live")
      .sort((a, b) => b.earlyMomentumScore - a.earlyMomentumScore || a.ageMinutes - b.ageMinutes);
    const liveKeys = new Set(candidates.map((candidate) => candidate.tokenKey));
    const recentCandidates = materializedAll
      .filter((candidate) => !liveKeys.has(candidate.tokenKey))
      .filter((candidate) => now - new Date(candidate.firstDetectedAt).getTime() <= RECENT_DETECTION_WINDOW_MS)
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
      .slice(0, 30);

    // Catalyst Intelligence: only strongest live candidates, with engine-side cache.
    const catalystTargets = candidates.slice(0, 8);
    await Promise.all(catalystTargets.map(async (candidate) => {
      try { candidate.catalystAssessment = await assessCatalyst(candidate); } catch { candidate.catalystAssessment = null; }
    }));

    try { await syncTradingLab(materializedAll, candidates); }
    catch (error) { console.warn("[MemeScope][TradingLab] sync failed:", error instanceof Error ? error.message : String(error)); }

    return {
      candidates,
      recentCandidates,
      generatedAt: iso(now),
      source: "dexscreener+coingecko",
      status: "live",
      scannedTokens: scanSeeds.size,
      rejectedTokens: rejected,
      listingEffect: listingEffectStats(allStored),
      continuation: contStats,
      note: "Descoberta primária via DexScreener; CoinGecko é verificada depois por contrato. Continuation Score é experimental e mede qualidade de continuação. Security Engine usa GoPlus + Solscan em Solana e um risco crítico pode bloquear o Live Radar. Máximo de 4 verificações CoinGecko e 2 security checks por ciclo para respeitar rate limits.",
    };
  } catch (err) {
    console.error("[MemeScope][Radar] refresh failed:", err instanceof Error ? err.message : String(err));
    const previousStates = await storage.listRadarCandidates();
    const previousContinuation = continuationStats(previousStates);
    const materializedPrevious = previousStates.map((s) => materialize(s, Date.now(), previousContinuation.return5m));
    const previous = materializedPrevious.filter((c) => c.currentStatus === "live").sort((a, b) => b.earlyMomentumScore - a.earlyMomentumScore);
    const recentCandidates = materializedPrevious.filter((c) => c.currentStatus !== "live").slice(0, 30);
    return {
      candidates: previous,
      recentCandidates,
      generatedAt: new Date().toISOString(),
      source: "dexscreener+coingecko",
      status: previous.length ? "live" : "unavailable",
      scannedTokens: 0,
      rejectedTokens: 0,
      listingEffect: listingEffectStats(previousStates),
      continuation: previousContinuation,
      note: previous.length ? "A mostrar os últimos candidatos guardados enquanto o feed recupera." : "Feed de descoberta temporariamente indisponível.",
      error: err instanceof Error ? err.message : "RADAR_UNAVAILABLE",
    };
  }
}

export async function getNewTokenRadarFeed(): Promise<RadarFeed> {
  const cached = cacheGet<RadarFeed>(CACHE_KEY);
  if (cached) return cached.value;
  const feed = await withCoalescing(CACHE_KEY, refreshNewTokenRadar);
  if (feed.candidates.length || feed.recentCandidates.length) cacheSet(CACHE_KEY, feed, CACHE_TTL_MS);
  return feed;
}
