import { MarketData, SourceMeta } from "./types";
import { cacheGet, cacheGetStale, cacheSet, withCoalescing } from "./cache";

const BASE = "https://api.coingecko.com/api/v3";
const API_KEY = process.env.COINGECKO_API_KEY; // opcional, plano demo/pro

// TTLs pensados para respeitar o limite gratuito da CoinGecko (~10-30 pedidos/min).
const MARKETS_TTL_MS = 45_000;
const CHART_TTL_MS = 60_000;
const STALE_AFTER_MS = 120_000; // acima disto, o estado passa a "stale" no UI

function headers(): HeadersInit {
  const h: Record<string, string> = { accept: "application/json" };
  if (API_KEY) h["x-cg-demo-api-key"] = API_KEY;
  return h;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    if (res.status === 429) throw new Error("RATE_LIMITED");
    throw new Error(`COINGECKO_HTTP_${res.status}`);
  }
  return (await res.json()) as T;
}

function toSourceMeta(storedAt: number | null, ok: boolean): SourceMeta {
  if (!ok && storedAt === null) {
    return { status: "unavailable", lastUpdated: null, source: "coingecko" };
  }
  const age = storedAt !== null ? Date.now() - storedAt : Infinity;
  return {
    status: age > STALE_AFTER_MS ? "stale" : "live",
    lastUpdated: storedAt ? new Date(storedAt).toISOString() : null,
    source: ok ? "coingecko" : "cache",
  };
}

interface RawMarketCoin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  market_cap: number | null;
  fully_diluted_valuation: number | null;
  total_volume: number | null;
  price_change_percentage_1h_in_currency: number | null;
  price_change_percentage_24h_in_currency: number | null;
  price_change_percentage_7d_in_currency: number | null;
  price_change_percentage_30d_in_currency: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  ath: number | null;
  ath_change_percentage: number | null;
  last_updated: string | null;
}

export function mapCoin(c: RawMarketCoin): MarketData {
  return {
    id: c.id,
    symbol: c.symbol?.toUpperCase() ?? "",
    name: c.name,
    image: c.image ?? null,
    price: c.current_price ?? null,
    marketCap: c.market_cap ?? null,
    fdv: c.fully_diluted_valuation ?? null,
    volume24h: c.total_volume ?? null,
    change1h: c.price_change_percentage_1h_in_currency ?? null,
    change24h: c.price_change_percentage_24h_in_currency ?? null,
    change7d: c.price_change_percentage_7d_in_currency ?? null,
    change30d: c.price_change_percentage_30d_in_currency ?? null,
    circulatingSupply: c.circulating_supply ?? null,
    totalSupply: c.total_supply ?? null,
    ath: c.ath ?? null,
    athChangePercent: c.ath_change_percentage ?? null,
    lastUpdated: c.last_updated ?? null,
  };
}
export type { RawMarketCoin };

/** Obtém dados de mercado para uma lista de coingeckoIds, com cache partilhada. */
export async function getMarkets(
  ids: string[]
): Promise<{ data: Record<string, MarketData>; meta: SourceMeta }> {
  const key = `markets:${ids.slice().sort().join(",")}`;
  const cached = cacheGet<Record<string, MarketData>>(key);
  if (cached) {
    return { data: cached.value, meta: toSourceMeta(cached.storedAt, false) };
  }

  return withCoalescing(key, async () => {
    try {
      const url =
        `${BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}` +
        `&price_change_percentage=1h,24h,7d,30d&per_page=250&page=1&sparkline=false`;
      const raw = await fetchJson<RawMarketCoin[]>(url);
      const data: Record<string, MarketData> = {};
      for (const c of raw) data[c.id] = mapCoin(c);
      cacheSet(key, data, MARKETS_TTL_MS);
      return { data, meta: toSourceMeta(Date.now(), true) };
    } catch {
      const stale = cacheGetStale<Record<string, MarketData>>(key);
      if (stale) {
        return { data: stale.value, meta: toSourceMeta(stale.storedAt, false) };
      }
      return { data: {}, meta: { status: "unavailable", lastUpdated: null, source: "coingecko" } };
    }
  });
}

export interface PricePoint {
  t: number; // epoch ms
  price: number;
}
export interface VolumePoint {
  t: number;
  volume: number;
}

export interface MarketChart {
  prices: PricePoint[];
  volumes: VolumePoint[];
}

/** Histórico de preço/volume (usado no gráfico de preço e no gráfico preço x volume). */
export async function getMarketChart(
  id: string,
  days: number | "max" = 30
): Promise<{ data: MarketChart | null; meta: SourceMeta }> {
  const key = `chart:${id}:${days}`;
  const cached = cacheGet<MarketChart>(key);
  if (cached) return { data: cached.value, meta: toSourceMeta(cached.storedAt, false) };

  return withCoalescing(key, async () => {
    try {
      const url = `${BASE}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`;
      const raw = await fetchJson<{ prices: [number, number][]; total_volumes: [number, number][] }>(
        url
      );
      const data: MarketChart = {
        prices: raw.prices.map(([t, price]) => ({ t, price })),
        volumes: raw.total_volumes.map(([t, volume]) => ({ t, volume })),
      };
      cacheSet(key, data, CHART_TTL_MS);
      return { data, meta: toSourceMeta(Date.now(), true) };
    } catch {
      const stale = cacheGetStale<MarketChart>(key);
      if (stale) return { data: stale.value, meta: toSourceMeta(stale.storedAt, false) };
      return { data: null, meta: { status: "unavailable", lastUpdated: null, source: "coingecko" } };
    }
  });
}

// ---------------------------------------------------------------------------
// Descoberta automática (categoria "meme-token" + trending + detalhe por moeda)
// ---------------------------------------------------------------------------

const CATEGORY_TTL_MS = 90_000;
const TRENDING_TTL_MS = 90_000;
const COIN_DETAIL_TTL_MS = 60 * 60_000; // 1h — contrato e data de génese não mudam

/** Universo de candidatas: todas as moedas da categoria "Meme" da CoinGecko, por volume. */
export async function getMemeCategoryMarkets(): Promise<{ data: MarketData[]; meta: SourceMeta }> {
  const key = "discovery:meme-universe";
  const cached = cacheGet<MarketData[]>(key);
  if (cached) return { data: cached.value, meta: toSourceMeta(cached.storedAt, false) };

  return withCoalescing(key, async () => {
    try {
      const url =
        `${BASE}/coins/markets?vs_currency=usd&category=meme-token&order=volume_desc` +
        `&per_page=150&page=1&price_change_percentage=1h,24h,7d,30d&sparkline=false`;
      const raw = await fetchJson<RawMarketCoin[]>(url);
      const data = raw.map(mapCoin);
      cacheSet(key, data, CATEGORY_TTL_MS);
      return { data, meta: toSourceMeta(Date.now(), true) };
    } catch {
      const stale = cacheGetStale<MarketData[]>(key);
      if (stale) return { data: stale.value, meta: toSourceMeta(stale.storedAt, false) };
      return { data: [], meta: { status: "unavailable", lastUpdated: null, source: "coingecko" } };
    }
  });
}

interface RawTrendingItem {
  item: { id: string; symbol: string; market_cap_rank: number | null; score: number };
}

/** IDs em tendência na CoinGecko neste momento (pesquisas recentes), sem filtrar por categoria. */
export async function getTrendingIds(): Promise<{ data: Map<string, number>; meta: SourceMeta }> {
  const key = "discovery:trending";
  const cached = cacheGet<[string, number][]>(key);
  if (cached) return { data: new Map(cached.value), meta: toSourceMeta(cached.storedAt, false) };

  return withCoalescing(key, async () => {
    try {
      const raw = await fetchJson<{ coins: RawTrendingItem[] }>(`${BASE}/search/trending`);
      const entries: [string, number][] = raw.coins.map((c) => [c.item.id, c.item.score]);
      cacheSet(key, entries, TRENDING_TTL_MS);
      return { data: new Map(entries), meta: toSourceMeta(Date.now(), true) };
    } catch {
      const stale = cacheGetStale<[string, number][]>(key);
      if (stale) return { data: new Map(stale.value), meta: toSourceMeta(stale.storedAt, false) };
      return { data: new Map(), meta: { status: "unavailable", lastUpdated: null, source: "coingecko" } };
    }
  });
}

export interface CoinPlatformDetail {
  contractAddress: string | null;
  chain: "ethereum" | "solana" | "base" | "bsc" | "unknown";
  genesisDate: string | null;
}

const PLATFORM_PRIORITY: Array<{ key: string; chain: CoinPlatformDetail["chain"] }> = [
  { key: "solana", chain: "solana" },
  { key: "ethereum", chain: "ethereum" },
  { key: "base", chain: "base" },
  { key: "binance-smart-chain", chain: "bsc" },
];

/** Contrato e data de génese de uma moeda específica — só pedido para a shortlist final (poucas moedas). */
export async function getCoinPlatformDetail(
  id: string
): Promise<{ data: CoinPlatformDetail; meta: SourceMeta }> {
  const key = `discovery:detail:${id}`;
  const cached = cacheGet<CoinPlatformDetail>(key);
  if (cached) return { data: cached.value, meta: toSourceMeta(cached.storedAt, false) };

  return withCoalescing(key, async () => {
    try {
      const url = `${BASE}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`;
      const raw = await fetchJson<{ platforms: Record<string, string>; genesis_date: string | null }>(url);
      let contractAddress: string | null = null;
      let chain: CoinPlatformDetail["chain"] = "unknown";
      for (const p of PLATFORM_PRIORITY) {
        const addr = raw.platforms?.[p.key];
        if (addr) {
          contractAddress = addr;
          chain = p.chain;
          break;
        }
      }
      const data: CoinPlatformDetail = { contractAddress, chain, genesisDate: raw.genesis_date ?? null };
      cacheSet(key, data, COIN_DETAIL_TTL_MS);
      return { data, meta: toSourceMeta(Date.now(), true) };
    } catch {
      const stale = cacheGetStale<CoinPlatformDetail>(key);
      if (stale) return { data: stale.value, meta: toSourceMeta(stale.storedAt, false) };
      return {
        data: { contractAddress: null, chain: "unknown", genesisDate: null },
        meta: { status: "unavailable", lastUpdated: null, source: "coingecko" },
      };
    }
  });
}
