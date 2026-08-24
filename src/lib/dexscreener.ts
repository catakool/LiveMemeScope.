import { Chain, DexPairData, SourceMeta } from "./types";
import { cacheGet, cacheGetStale, cacheSet, withCoalescing } from "./cache";

const BASE = "https://api.dexscreener.com";
const TTL_MS = 30_000;
const STALE_AFTER_MS = 90_000;

function toSourceMeta(storedAt: number | null, ok: boolean): SourceMeta {
  if (!ok && storedAt === null) {
    return { status: "unavailable", lastUpdated: null, source: "dexscreener" };
  }
  const age = storedAt !== null ? Date.now() - storedAt : Infinity;
  return {
    status: age > STALE_AFTER_MS ? "stale" : "live",
    lastUpdated: storedAt ? new Date(storedAt).toISOString() : null,
    source: ok ? "dexscreener" : "cache",
  };
}

interface RawWindowTxns {
  buys: number | null;
  sells: number | null;
}

interface RawPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  priceUsd: string | null;
  liquidity?: { usd: number | null };
  volume?: { m5?: number | null; h1?: number | null; h6?: number | null; h24: number | null };
  txns?: {
    m5?: RawWindowTxns;
    h1?: RawWindowTxns;
    h6?: RawWindowTxns;
    h24?: RawWindowTxns;
  };
  priceChange?: { m5?: number | null; h1?: number | null; h6?: number | null; h24?: number | null };
  pairCreatedAt?: number;
  fdv?: number | null;
}

function mapChain(chainId: string): Chain {
  if (chainId === "ethereum") return "ethereum";
  if (chainId === "solana") return "solana";
  if (chainId === "base") return "base";
  if (chainId === "bsc") return "bsc";
  return "unknown";
}

function pickBestPair(pairs: RawPair[], expectedChain?: Chain): RawPair | null {
  if (!pairs.length) return null;
  // O mesmo endereço pode existir em múltiplas chains (ex.: clones/bridges).
  // Se soubermos a chain esperada (a partir do registo verificado), filtramos primeiro.
  const scoped = expectedChain ? pairs.filter((p) => mapChain(p.chainId) === expectedChain) : pairs;
  const pool = scoped.length > 0 ? scoped : pairs;
  // Escolhe o par com maior liquidez (mais representativo do preço real).
  return pool.reduce((best, p) => ((p.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? p : best));
}

function mapWindowTxns(t?: RawWindowTxns): { buys: number | null; sells: number | null } {
  return { buys: t?.buys ?? null, sells: t?.sells ?? null };
}

function mapPair(p: RawPair): DexPairData {
  return {
    pairAddress: p.pairAddress ?? null,
    dexId: p.dexId ?? null,
    chain: mapChain(p.chainId),
    priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
    liquidityUsd: p.liquidity?.usd ?? null,
    volume24hUsd: p.volume?.h24 ?? null,
    txns24h: mapWindowTxns(p.txns?.h24),
    pairCreatedAt: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null,
    fdv: p.fdv ?? null,
    volumeM5: p.volume?.m5 ?? null,
    volumeH1: p.volume?.h1 ?? null,
    volumeH6: p.volume?.h6 ?? null,
    txnsM5: mapWindowTxns(p.txns?.m5),
    txnsH1: mapWindowTxns(p.txns?.h1),
    txnsH6: mapWindowTxns(p.txns?.h6),
    priceChangeM5: p.priceChange?.m5 ?? null,
    priceChangeH1: p.priceChange?.h1 ?? null,
    priceChangeH6: p.priceChange?.h6 ?? null,
    priceChangeH24: p.priceChange?.h24 ?? null,
  };
}

/** Procura pares de um token pelo endereço de contrato (recomendado) na DexScreener. */
export async function getDexDataByAddress(
  address: string,
  expectedChain?: Chain
): Promise<{ data: DexPairData | null; meta: SourceMeta }> {
  const key = `dex:addr:${address.toLowerCase()}:${expectedChain ?? "any"}`;
  const cached = cacheGet<DexPairData | null>(key);
  if (cached) return { data: cached.value, meta: toSourceMeta(cached.storedAt, false) };

  return withCoalescing(key, async () => {
    try {
      const res = await fetch(`${BASE}/latest/dex/tokens/${encodeURIComponent(address)}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`DEXSCREENER_HTTP_${res.status}`);
      const raw = (await res.json()) as { pairs: RawPair[] | null };
      const best = pickBestPair(raw?.pairs ?? [], expectedChain);
      const data = best ? mapPair(best) : null;
      cacheSet(key, data, TTL_MS);
      return { data, meta: toSourceMeta(Date.now(), true) };
    } catch {
      const stale = cacheGetStale<DexPairData | null>(key);
      if (stale) return { data: stale.value, meta: toSourceMeta(stale.storedAt, false) };
      return { data: null, meta: { status: "unavailable", lastUpdated: null, source: "dexscreener" } };
    }
  });
}

/** Pesquisa livre (símbolo/nome) — usada só no ecrã "Adicionar token", nunca para os dados principais. */
export async function searchDexPairs(
  query: string
): Promise<{ data: DexPairData[]; meta: SourceMeta }> {
  const key = `dex:search:${query.toLowerCase()}`;
  const cached = cacheGet<DexPairData[]>(key);
  if (cached) return { data: cached.value, meta: toSourceMeta(cached.storedAt, false) };

  try {
    const res = await fetch(`${BASE}/latest/dex/search?q=${encodeURIComponent(query)}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`DEXSCREENER_HTTP_${res.status}`);
    const raw = (await res.json()) as { pairs: RawPair[] | null };
    const data = (raw.pairs ?? []).slice(0, 15).map(mapPair);
    cacheSet(key, data, TTL_MS);
    return { data, meta: toSourceMeta(Date.now(), true) };
  } catch {
    const stale = cacheGetStale<DexPairData[]>(key);
    if (stale) return { data: stale.value, meta: toSourceMeta(stale.storedAt, false) };
    return { data: [], meta: { status: "unavailable", lastUpdated: null, source: "dexscreener" } };
  }
}
