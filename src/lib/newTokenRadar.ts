import { cacheGet, cacheSet, withCoalescing } from "./cache";
import { Chain } from "./types";
import { getStorage, RadarCandidateState } from "./storage";

const BASE = "https://api.dexscreener.com";
const CACHE_KEY = "new-token-radar:v1";
const CACHE_TTL_MS = 45_000;
const RADAR_TTL_SECONDS = 72 * 60 * 60;

const SUPPORTED_CHAINS: Record<string, Chain> = { solana: "solana", ethereum: "ethereum", base: "base", bsc: "bsc" };

export type RadarClassification = "explosive" | "breakout" | "emerging";
export type RadarSource = "latest_profile" | "boosted" | "both";

interface RawProfile { chainId?: string; tokenAddress?: string }
interface RawBoost { chainId?: string; tokenAddress?: string; amount?: number; totalAmount?: number }
interface RawTokenRef { address?: string; name?: string; symbol?: string }
interface RawPair {
  chainId?: string; dexId?: string; pairAddress?: string; baseToken?: RawTokenRef; quoteToken?: RawTokenRef;
  priceUsd?: string | null; liquidity?: { usd?: number | null };
  volume?: { m5?: number | null; h1?: number | null; h6?: number | null; h24?: number | null };
  txns?: { m5?: { buys?: number | null; sells?: number | null }; h1?: { buys?: number | null; sells?: number | null } };
  priceChange?: { m5?: number | null; h1?: number | null; h6?: number | null; h24?: number | null };
  pairCreatedAt?: number | null; fdv?: number | null; marketCap?: number | null;
}

export interface RadarCandidate {
  tokenKey: string; chain: Chain; address: string; name: string; symbol: string; pairAddress: string | null; dexId: string | null;
  pairCreatedAt: string; ageMinutes: number; firstDetectedAt: string; detectedMinutesAgo: number; firstDetectedPrice: number | null;
  price: number | null; returnSinceDetected: number | null; liquidityUsd: number | null; marketCapOrFdv: number | null; marketCapIsFdv: boolean;
  volumeM5: number | null; volumeH1: number | null; buysM5: number | null; sellsM5: number | null; priceChangeM5: number | null; priceChangeH1: number | null;
  source: RadarSource; boosted: boolean; boostAmount: number | null; earlyMomentumScore: number; classification: RadarClassification;
  reasons: string[]; risks: string[]; dexUrl: string;
}

export interface RadarFeed {
  candidates: RadarCandidate[]; generatedAt: string; source: "dexscreener"; status: "live" | "unavailable";
  scannedTokens: number; rejectedTokens: number; note: string; error?: string;
}

function clamp(v: number, min = 0, max = 100) { return Math.min(max, Math.max(min, v)); }
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function chainOf(raw?: string): Chain | null { return raw ? SUPPORTED_CHAINS[raw.toLowerCase()] ?? null : null; }
function keyOf(chain: Chain, address: string) { return `${chain}:${address.toLowerCase()}`; }

function scorePair(pair: RawPair, source: RadarSource): { score: number; classification: RadarClassification | null; reasons: string[]; risks: string[] } {
  const liquidity = num(pair.liquidity?.usd); const v5 = num(pair.volume?.m5); const v1h = num(pair.volume?.h1);
  const pc5 = num(pair.priceChange?.m5); const pc1h = num(pair.priceChange?.h1);
  const buys = num(pair.txns?.m5?.buys) ?? 0; const sells = num(pair.txns?.m5?.sells) ?? 0; const tx = buys + sells;
  const created = num(pair.pairCreatedAt);
  if (!created) return { score: 0, classification: null, reasons: [], risks: ["Idade do par indisponível"] };
  const ageMin = Math.max(0, (Date.now() - created) / 60_000);
  const reasons: string[] = []; const risks: string[] = [];

  if (ageMin > 48 * 60) return { score: 0, classification: null, reasons, risks: ["Par com mais de 48h"] };
  if (liquidity === null || liquidity < 10_000) return { score: 0, classification: null, reasons, risks: ["Liquidez inferior a $10k"] };
  if (tx < 10) return { score: 0, classification: null, reasons, risks: ["Poucas transações nos últimos 5m"] };
  if (v5 === null || v5 < 1_500) return { score: 0, classification: null, reasons, risks: ["Volume 5m insuficiente"] };

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

  const turnover5 = liquidity > 0 ? v5 / liquidity : 0;
  score += clamp((turnover5 / 0.55) * 24, 0, 24);
  if (turnover5 >= 0.2) reasons.push(`Volume 5m equivale a ${(turnover5 * 100).toFixed(0)}% da liquidez`);

  score += clamp((Math.log10(Math.max(tx, 10) / 10 + 1) / Math.log10(11)) * 13, 0, 13);
  const buyRatio = tx > 0 ? buys / tx : 0.5;
  score += clamp(((buyRatio - 0.45) / 0.35) * 15, 0, 15);
  if (tx >= 20 && buyRatio >= 0.62) reasons.push(`${(buyRatio * 100).toFixed(0)}% das transações 5m são compras`);

  if (ageMin <= 30) score += 10; else if (ageMin <= 120) score += 8; else if (ageMin <= 360) score += 5; else score += 2;

  if (source !== "latest_profile") {
    score += 1;
    risks.push("Token boosted/promovido na DexScreener — promoção paga não é sinal de qualidade");
  }
  if (liquidity < 25_000) risks.push("Liquidez ainda baixa (< $25k)");
  if (ageMin < 10) risks.push("Par extremamente recente (<10 min)");
  if (v1h !== null && v5 * 12 > v1h * 4) reasons.push("Ritmo de volume 5m muito acima do ritmo da última hora");

  score = Math.round(clamp(score) * 10) / 10;
  let classification: RadarClassification | null = null;
  if (score >= 85 && liquidity >= 25_000 && tx >= 30 && (pc5 ?? 0) >= 8) classification = "explosive";
  else if (score >= 70 && liquidity >= 15_000 && tx >= 20 && (pc5 ?? 0) >= 4) classification = "breakout";
  else if (score >= 55 && (pc5 ?? 0) > 0) classification = "emerging";
  return { score, classification, reasons, risks };
}

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error(`DEX_HTTP_${res.status}`);
    return await res.json() as T;
  } finally { clearTimeout(timer); }
}

async function fetchSeeds() {
  const [profilesRes, boostsRes] = await Promise.allSettled([
    fetchJson<RawProfile[]>(`${BASE}/token-profiles/latest/v1`),
    fetchJson<RawBoost[]>(`${BASE}/token-boosts/latest/v1`),
  ]);
  const seeds = new Map<string, { chain: Chain; address: string; source: RadarSource; boostAmount: number | null }>();
  if (profilesRes.status === "fulfilled") for (const p of profilesRes.value ?? []) {
    const chain = chainOf(p.chainId); const address = p.tokenAddress?.trim(); if (!chain || !address) continue;
    seeds.set(keyOf(chain, address), { chain, address, source: "latest_profile", boostAmount: null });
  }
  if (boostsRes.status === "fulfilled") for (const b of boostsRes.value ?? []) {
    const chain = chainOf(b.chainId); const address = b.tokenAddress?.trim(); if (!chain || !address) continue;
    const key = keyOf(chain, address); const existing = seeds.get(key);
    seeds.set(key, { chain, address, source: existing ? "both" : "boosted", boostAmount: num(b.amount) ?? num(b.totalAmount) });
  }
  if (!seeds.size) throw new Error("DEX_DISCOVERY_FEEDS_UNAVAILABLE");
  return seeds;
}

async function fetchPairsForSeeds(seeds: Map<string, { chain: Chain; address: string }>): Promise<Map<string, RawPair>> {
  const byChain = new Map<Chain, string[]>();
  for (const s of seeds.values()) byChain.set(s.chain, [...(byChain.get(s.chain) ?? []), s.address]);
  const output = new Map<string, RawPair>(); const jobs: Promise<void>[] = [];
  for (const [chain, addresses] of byChain) for (let i = 0; i < addresses.length; i += 25) {
    const batch = addresses.slice(i, i + 25);
    jobs.push((async () => {
      try {
        const pairs = await fetchJson<RawPair[]>(`${BASE}/tokens/v1/${chain}/${batch.join(",")}`);
        for (const pair of pairs ?? []) {
          const base = pair.baseToken?.address; if (!base) continue;
          const key = keyOf(chain, base); if (!seeds.has(key)) continue;
          const current = output.get(key);
          if (!current || (num(pair.liquidity?.usd) ?? 0) > (num(current.liquidity?.usd) ?? 0)) output.set(key, pair);
        }
      } catch (err) {
        console.warn(`[MemeScope][Radar] batch ${chain} failed:`, err instanceof Error ? err.message : String(err));
      }
    })());
  }
  await Promise.all(jobs); return output;
}

function materialize(state: RadarCandidateState, now = Date.now()): RadarCandidate {
  return {
    ...state,
    ageMinutes: Math.max(0, (now - new Date(state.pairCreatedAt).getTime()) / 60_000),
    detectedMinutesAgo: Math.max(0, (now - new Date(state.firstDetectedAt).getTime()) / 60_000),
    returnSinceDetected: state.price !== null && state.firstDetectedPrice !== null && state.firstDetectedPrice > 0 ? ((state.price - state.firstDetectedPrice) / state.firstDetectedPrice) * 100 : null,
    boosted: state.source !== "latest_profile",
    dexUrl: `https://dexscreener.com/${state.chain}/${state.pairAddress ?? state.address}`,
  };
}

export async function refreshNewTokenRadar(): Promise<RadarFeed> {
  const storage = getStorage();
  try {
    const existing = await storage.listRadarCandidates();
    const existingByKey = new Map(existing.map((c) => [c.tokenKey, c]));
    const seeds = await fetchSeeds(); const pairs = await fetchPairsForSeeds(seeds); const now = Date.now();
    let rejected = 0; const candidates: RadarCandidate[] = [];
    for (const [key, seed] of seeds) {
      const pair = pairs.get(key); if (!pair?.pairCreatedAt) { rejected++; continue; }
      const scored = scorePair(pair, seed.source); if (!scored.classification) { rejected++; continue; }
      const price = pair.priceUsd ? Number(pair.priceUsd) : null; const prior = existingByKey.get(key);
      const firstDetectedAt = prior?.firstDetectedAt ?? new Date(now).toISOString(); const firstDetectedPrice = prior?.firstDetectedPrice ?? price;
      const marketCap = num(pair.marketCap); const fdv = num(pair.fdv);
      const state: RadarCandidateState = {
        tokenKey: key, chain: seed.chain, address: seed.address, name: pair.baseToken?.name ?? pair.baseToken?.symbol ?? "Token",
        symbol: pair.baseToken?.symbol ?? "TOKEN", pairAddress: pair.pairAddress ?? null, dexId: pair.dexId ?? null,
        pairCreatedAt: new Date(pair.pairCreatedAt).toISOString(), firstDetectedAt, firstDetectedPrice, lastSeenAt: new Date(now).toISOString(),
        price, liquidityUsd: num(pair.liquidity?.usd), marketCapOrFdv: marketCap ?? fdv, marketCapIsFdv: marketCap === null && fdv !== null,
        volumeM5: num(pair.volume?.m5), volumeH1: num(pair.volume?.h1), buysM5: num(pair.txns?.m5?.buys), sellsM5: num(pair.txns?.m5?.sells),
        priceChangeM5: num(pair.priceChange?.m5), priceChangeH1: num(pair.priceChange?.h1), source: seed.source, boostAmount: seed.boostAmount,
        earlyMomentumScore: scored.score, classification: scored.classification, reasons: scored.reasons, risks: scored.risks,
      };
      await storage.setRadarCandidate(state, RADAR_TTL_SECONDS); candidates.push(materialize(state, now));
    }
    candidates.sort((a,b)=>b.earlyMomentumScore-a.earlyMomentumScore || a.ageMinutes-b.ageMinutes);
    return { candidates, generatedAt: new Date().toISOString(), source: "dexscreener", status: "live", scannedTokens: seeds.size, rejectedTokens: rejected,
      note: "Baseado nos feeds públicos de perfis/boosts recentes da DexScreener e filtrado por idade do par, liquidez, volume, transações e momentum. Não é uma varredura exaustiva de todas as blockchains." };
  } catch (err) {
    console.error("[MemeScope][Radar] refresh failed:", err instanceof Error ? err.message : String(err));
    const previous = (await storage.listRadarCandidates()).map((s)=>materialize(s)).sort((a,b)=>b.earlyMomentumScore-a.earlyMomentumScore);
    return { candidates: previous, generatedAt: new Date().toISOString(), source: "dexscreener", status: previous.length ? "live" : "unavailable", scannedTokens: 0, rejectedTokens: 0,
      note: previous.length ? "A mostrar os últimos candidatos guardados enquanto o feed recupera." : "Feed de descoberta temporariamente indisponível.",
      error: err instanceof Error ? err.message : "RADAR_UNAVAILABLE" };
  }
}

export async function getNewTokenRadarFeed(): Promise<RadarFeed> {
  const cached = cacheGet<RadarFeed>(CACHE_KEY); if (cached) return cached.value;
  const feed = await withCoalescing(CACHE_KEY, refreshNewTokenRadar); if (feed.candidates.length) cacheSet(CACHE_KEY, feed, CACHE_TTL_MS); return feed;
}
