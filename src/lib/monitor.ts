import { getDiscoveryFeed, mapWithConcurrency } from "./discovery";
import { upsertDiscoveredToken, listWatchedTokens } from "./tokenRegistry";
import { getMarkets } from "./coingecko";
import { getDexDataByAddress } from "./dexscreener";
import { computeOpportunity, OpportunityClassification } from "./opportunity";
import { getStorage, Snapshot, StoredSignal, watchedTokenKey, WatchedTokenRecord } from "./storage";
import { MarketData, DexPairData } from "./types";
import { NULL_CATALYST_PROVIDER } from "./catalystProvider";

// ---------------------------------------------------------------------------
// Job de monitorização (Fase 4). Pensado para correr num Vercel Cron Job,
// NUNCA num setInterval de uma função serverless (que não é fiável em produção).
// ---------------------------------------------------------------------------

const MAX_TOKENS_PER_RUN = 40; // limite de segurança para respeitar rate limits e a duração máxima da função
const SNAPSHOT_HISTORY_LIMIT = 200; // ~6-7h de histórico a cadência de 2min
const SNAPSHOT_LOOKBACK_MS = 90 * 60_000; // 90 min de histórico é suficiente para momentum/volume
const SIGNAL_GLOBAL_HISTORY_LIMIT = 500;

const TIER_RANK: Record<OpportunityClassification, number> = {
  no_signal: 0,
  watch: 1,
  high_momentum_watch: 2,
  strong_opportunity: 3,
  very_strong_opportunity: 4,
};

function buildSnapshot(token: WatchedTokenRecord, market: MarketData | null, dex: DexPairData | null): Snapshot {
  return {
    tokenKey: token.key,
    chain: token.chain,
    address: token.contractAddress,
    coingeckoId: token.coingeckoId,
    timestamp: Date.now(),
    price: market?.price ?? dex?.priceUsd ?? null,
    marketCap: market?.marketCap ?? null,
    liquidityUsd: dex?.liquidityUsd ?? null,
    volumeM5: dex?.volumeM5 ?? null,
    volumeH1: dex?.volumeH1 ?? null,
    volumeH6: dex?.volumeH6 ?? null,
    volumeH24: dex?.volume24hUsd ?? market?.volume24h ?? null,
    buysM5: dex?.txnsM5?.buys ?? null,
    sellsM5: dex?.txnsM5?.sells ?? null,
    buysH1: dex?.txnsH1?.buys ?? null,
    sellsH1: dex?.txnsH1?.sells ?? null,
    buysH6: dex?.txnsH6?.buys ?? null,
    sellsH6: dex?.txnsH6?.sells ?? null,
    buysH24: dex?.txns24h?.buys ?? null,
    sellsH24: dex?.txns24h?.sells ?? null,
  };
}

export interface MonitorCycleSummary {
  tokensConsidered: number;
  tokensProcessed: number;
  snapshotsSaved: number;
  signalsGenerated: number;
  storage: "redis" | "memory";
  errors: string[];
}

export async function runMonitorCycle(): Promise<MonitorCycleSummary> {
  const storage = getStorage();
  const errors: string[] = [];

  // 1) Atualiza o registo com o que o Discovery Engine considera interessante agora.
  let discoveryRecords: Awaited<ReturnType<typeof getDiscoveryFeed>>["records"] = [];
  try {
    const discovery = await getDiscoveryFeed();
    discoveryRecords = discovery.records;
    await Promise.all(discoveryRecords.map((r) => upsertDiscoveredToken(r.def, r.discovery.rankScore)));
  } catch (err) {
    errors.push(`discovery: ${(err as Error).message}`);
  }

  // 2) Lista unificada de tokens vigiados (manuais + descoberta, já sem os "discovery" obsoletos).
  const watched = await listWatchedTokens();

  // 3) Prioriza: manuais primeiro, depois por prioridade (rankScore/discovery), corta ao limite do batch.
  const prioritized = [...watched].sort((a, b) => {
    if (a.source !== b.source) return a.source === "manual" ? -1 : 1;
    return b.priority - a.priority;
  });
  const batch = prioritized.slice(0, MAX_TOKENS_PER_RUN);

  // 4) Reaproveita os dados já obtidos pelo Discovery Engine (evita pedidos duplicados à CoinGecko/DexScreener).
  const discoveryByKey = new Map(
    discoveryRecords.map((r) => [
      watchedTokenKey({ chain: r.def.chain, address: r.def.contractAddress, coingeckoId: r.def.coingeckoId }),
      r,
    ])
  );

  const needsMarket = batch.filter((t) => !discoveryByKey.has(t.key) && t.coingeckoId);
  const marketIds = Array.from(new Set(needsMarket.map((t) => t.coingeckoId as string)));
  let extraMarkets: Record<string, MarketData> = {};
  if (marketIds.length > 0) {
    try {
      const { data } = await getMarkets(marketIds);
      extraMarkets = data;
    } catch (err) {
      errors.push(`markets: ${(err as Error).message}`);
    }
  }

  const needsDex = batch.filter((t) => !discoveryByKey.has(t.key) && t.contractAddress);

  const extraDexEntries = await mapWithConcurrency(needsDex, 5, async (t) => {
    try {
      const { data } = await getDexDataByAddress(t.contractAddress as string, t.chain);
      return { key: t.key, data };
    } catch (err) {
      errors.push(`dex(${t.symbol}): ${(err as Error).message}`);
      return { key: t.key, data: null as DexPairData | null };
    }
  });
  const extraDexByKey = new Map(extraDexEntries.map((e) => [e.key, e.data]));

  let snapshotsSaved = 0;
  let signalsGenerated = 0;
  let tokensProcessed = 0;

  for (const token of batch) {
    try {
      const discoveryHit = discoveryByKey.get(token.key);
      const market: MarketData | null = discoveryHit?.market ?? (token.coingeckoId ? extraMarkets[token.coingeckoId] ?? null : null);
      const dex: DexPairData | null = discoveryHit?.dex ?? extraDexByKey.get(token.key) ?? null;

      if (!market && !dex) continue; // sem nenhum dado real, não vale a pena gravar um snapshot vazio

      const previous = await storage.getRecentSnapshots(token.key, Date.now() - SNAPSHOT_LOOKBACK_MS);
      const newSnapshot = buildSnapshot(token, market, dex);
      const combined = [...previous, newSnapshot];

      const catalysts = await NULL_CATALYST_PROVIDER.getCatalysts({
        coingeckoId: token.coingeckoId,
        chain: token.chain,
        address: token.contractAddress,
      });
      const opportunity = computeOpportunity(combined, market, dex, catalysts);

      await storage.appendSnapshot(newSnapshot, SNAPSHOT_HISTORY_LIMIT);
      snapshotsSaved += 1;
      tokensProcessed += 1;

      // 5) Deduplicação/cooldown: só regista um novo sinal quando o TIER sobe face ao último conhecido.
      const last = await storage.getLastClassification(token.key);
      const lastRank = last ? TIER_RANK[last.classification] : -1;
      const newRank = TIER_RANK[opportunity.classification];

      if (opportunity.classification !== "no_signal" && newRank > lastRank) {
        const signal: StoredSignal = {
          id: `${token.key}-${Date.now()}`,
          tokenKey: token.key,
          coingeckoId: token.coingeckoId,
          chain: token.chain,
          address: token.contractAddress,
          symbol: token.symbol,
          timestamp: new Date().toISOString(),
          price: newSnapshot.price,
          marketCap: newSnapshot.marketCap,
          liquidityUsd: newSnapshot.liquidityUsd,
          volumeH24: newSnapshot.volumeH24,
          opportunityScore: opportunity.total,
          components: { ...opportunity.components },
          confidence: opportunity.confidence,
          classification: opportunity.classification,
          reasons: opportunity.reasons,
          risks: opportunity.risks,
          invalidatedByRisk: opportunity.invalidatedByRisk,
        };
        await storage.appendSignal(signal, SIGNAL_GLOBAL_HISTORY_LIMIT);
        signalsGenerated += 1;
      }

      await storage.setLastClassification(token.key, {
        classification: opportunity.classification,
        score: opportunity.total,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      errors.push(`token(${token.symbol}): ${(err as Error).message}`);
    }
  }

  return {
    tokensConsidered: watched.length,
    tokensProcessed,
    snapshotsSaved,
    signalsGenerated,
    storage: storage.kind,
    errors,
  };
}
