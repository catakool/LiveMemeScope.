import { cacheGet, cacheSet, withCoalescing } from "./cache";
import { resolveCoinGeckoByContract } from "./coingecko";
import { Chain } from "./types";
import { getStorage, RadarCandidateState } from "./storage";

const BASE = "https://api.dexscreener.com";
const CACHE_KEY = "new-token-radar:v2";
const CACHE_TTL_MS = 45_000;
const RADAR_TTL_SECONDS = 8 * 24 * 60 * 60;
const RECENT_DETECTION_WINDOW_MS = 48 * 60 * 60_000;
const RADAR_STALE_AFTER_MS = 15 * 60_000;
const MAX_PAIR_AGE_MINUTES = 7 * 24 * 60;
const MAX_COINGECKO_CHECKS_PER_REFRESH = 4;
const COINGECKO_RECHECK_MS = 15 * 60_000;
const COINGECKO_ERROR_RECHECK_MS = 30 * 60_000;

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
  note: string;
  error?: string;
}

function clamp(v: number, min = 0, max = 100) { return Math.min(max, Math.max(min, v)); }
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function chainOf(raw?: string): Chain | null { return raw ? SUPPORTED_CHAINS[raw.toLowerCase()] ?? null : null; }
function keyOf(chain: Chain, address: string) { return `${chain}:${address.toLowerCase()}`; }
function iso(ms: number) { return new Date(ms).toISOString(); }

function scorePair(
  pair: RawPair,
  source: RadarSource
): { score: number; classification: RadarClassification | null; reasons: string[]; risks: string[] } {
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

  if (!created) return { score: 0, classification: null, reasons: [], risks: ["Idade do par indisponível"] };
  const ageMin = Math.max(0, (Date.now() - created) / 60_000);
  const reasons: string[] = [];
  const risks: string[] = [];

  if (ageMin > MAX_PAIR_AGE_MINUTES) {
    return { score: 0, classification: null, reasons, risks: ["Par fora da janela de 7 dias do Radar"] };
  }
  if (liquidity === null || liquidity < 10_000) {
    return { score: 0, classification: null, reasons, risks: ["Liquidez inferior a $10k"] };
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
    if (tx5 < 10) return { score: 0, classification: null, reasons, risks: ["Poucas transações nos últimos 5m"] };
    if (v5 === null || v5 < 1_500) return { score: 0, classification: null, reasons, risks: ["Volume 5m insuficiente"] };
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

  const txForScore = Math.max(tx5, Math.min(tx1h / 12, 300));
  score += clamp((Math.log10(Math.max(txForScore, 10) / 10 + 1) / Math.log10(11)) * 13, 0, 13);
  const buyRatio = tx5 > 0 ? buys5 / tx5 : tx1h > 0 ? buys1h / tx1h : 0.5;
  score += clamp(((buyRatio - 0.45) / 0.35) * 15, 0, 15);
  if (tx5 >= 20 && buyRatio >= 0.62) reasons.push(`${(buyRatio * 100).toFixed(0)}% das transações 5m são compras`);

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

  score = Math.round(clamp(score) * 10) / 10;
  let classification: RadarClassification | null = null;
  if (score >= 85 && liquidity >= 25_000 && tx5 >= 30 && (pc5 ?? 0) >= 8) classification = "explosive";
  else if (score >= 70 && liquidity >= 15_000 && tx5 >= 20 && (pc5 ?? 0) >= 4) classification = "breakout";
  else if (score >= 55 && (pc5 ?? 0) > 0) classification = "emerging";
  else if (matureEligible) {
    classification = "mature";
    reasons.push("DEX Mature: atividade e liquidez sustentadas apesar de já não estar na fase inicial");
  }

  return { score, classification, reasons, risks };
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

function materialize(stateRaw: RadarCandidateState, now = Date.now()): RadarCandidate {
  const state = normalizeState(stateRaw);
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
      const qualifiesNow = Boolean(scored.classification);
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
      const classification = scored.classification ?? prior?.classification;
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
        source: seed.source,
        boostAmount: seed.boostAmount,
        earlyMomentumScore: scored.score,
        classification,
        isLive: qualifiesNow,
        currentStatus: qualifiesNow ? "live" : "lost_momentum",
        currentStatusReason: rejectionReason,
        reasons: qualifiesNow ? scored.reasons : prior?.reasons ?? scored.reasons,
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
      states.push(state);
    }

    const enriched = await enrichCoinGecko(states, now);
    for (const state of enriched) await storage.setRadarCandidate(state, RADAR_TTL_SECONDS);

    const allStored = (await storage.listRadarCandidates()).map(normalizeState);
    const materializedAll = allStored.map((state) => materialize(state, now));
    const candidates = materializedAll
      .filter((candidate) => candidate.currentStatus === "live")
      .sort((a, b) => b.earlyMomentumScore - a.earlyMomentumScore || a.ageMinutes - b.ageMinutes);
    const liveKeys = new Set(candidates.map((candidate) => candidate.tokenKey));
    const recentCandidates = materializedAll
      .filter((candidate) => !liveKeys.has(candidate.tokenKey))
      .filter((candidate) => now - new Date(candidate.firstDetectedAt).getTime() <= RECENT_DETECTION_WINDOW_MS)
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
      .slice(0, 30);

    return {
      candidates,
      recentCandidates,
      generatedAt: iso(now),
      source: "dexscreener+coingecko",
      status: "live",
      scannedTokens: scanSeeds.size,
      rejectedTokens: rejected,
      listingEffect: listingEffectStats(allStored),
      note: "Descoberta primária via DexScreener; CoinGecko é verificada depois por contrato e passa a ter prioridade como source visível quando confirmada. Máximo de 4 verificações CoinGecko por ciclo para respeitar rate limits.",
    };
  } catch (err) {
    console.error("[MemeScope][Radar] refresh failed:", err instanceof Error ? err.message : String(err));
    const previousStates = await storage.listRadarCandidates();
    const materializedPrevious = previousStates.map((s) => materialize(s));
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
