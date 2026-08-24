import { CoinRecord, DiscoveryReason, RiskTier, TokenDefinition } from "./types";
import {
  getMemeCategoryMarkets,
  getTrendingIds,
  getCoinPlatformDetail,
  MarketChart,
} from "./coingecko";
import { getDexDataByAddress } from "./dexscreener";
import { computeScores } from "./scoring";
import { OpportunityResult } from "./opportunity";
import { watchedTokenKey } from "./tokenKey";

// ---------------------------------------------------------------------------
// MemeScope Discovery Engine
// ---------------------------------------------------------------------------
// Substitui a watchlist fixa por uma lista que se atualiza sozinha, combinando:
//  1) Tendência    — pesquisas recentes na CoinGecko (/search/trending)
//  2) Momentum     — a mesma fórmula do Opportunity Score, aplicada a toda a
//                     categoria "Meme" da CoinGecko
//  3) Par novo     — idade do par on-chain (DexScreener) ou data de génese
// Nada aqui é escolhido manualmente: a lista muda sozinha a cada atualização,
// consoante os dados reais das APIs.
// ---------------------------------------------------------------------------

const SHORTLIST_SIZE = 16;
const NEW_PAIR_MAX_AGE_DAYS = 30;
const MOMENTUM_THRESHOLD = 62; // Opportunity Score mínimo para justificar o rótulo "momentum"

export interface DiscoveryRecord extends CoinRecord {
  scores: ReturnType<typeof computeScores>;
  discovery: {
    reasons: DiscoveryReason[];
    rankScore: number; // usado só para ordenar a lista, não é mostrado como "verdade absoluta"
    trendingScore: number | null; // posição/pontuação do /search/trending, se aplicável
  };
  /**
   * Resultado do Opportunity Engine (lib/opportunity.ts), calculado a partir
   * do histórico de snapshots já guardado pelo job de monitorização.
   * `null` enquanto não houver histórico suficiente para este token.
   * Campo opcional/aditivo — não quebra nenhum consumidor existente que
   * ainda não o conheça.
   */
  opportunity?: OpportunityResult | null;
}

export function deriveRiskTier(marketCap: number | null): RiskTier {
  if (marketCap === null) return "extreme";
  if (marketCap >= 1_000_000_000) return "established";
  if (marketCap >= 100_000_000) return "momentum";
  if (marketCap >= 5_000_000) return "high-risk";
  return "extreme";
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  return d >= 0 ? d : null;
}

export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function getDiscoveryFeed(): Promise<{
  records: DiscoveryRecord[];
  universeSize: number;
  meta: { coingecko: import("./types").SourceMeta };
}> {
  const [{ data: universe, meta: universeMeta }, { data: trending }] = await Promise.all([
    getMemeCategoryMarkets(),
    getTrendingIds(),
  ]);

  // 1ª passagem: pontuação barata (só com dados de mercado) para ordenar todo o universo.
  const ranked = universe
    .map((market) => {
      const baseOpportunity = computeScores(market, null, null).opportunity.score ?? 0;
      const trendingScore = trending.get(market.id) ?? null;
      const trendingBonus = trendingScore !== null ? 100 : 0;
      const rankScore = 0.65 * baseOpportunity + 0.35 * trendingBonus;
      return { market, rankScore, trendingScore };
    })
    .sort((a, b) => b.rankScore - a.rankScore);

  const shortlist = ranked.slice(0, SHORTLIST_SIZE);

  // 2ª passagem: só para a shortlist, vamos buscar contrato/data de génese e dados on-chain.
  const enriched = await mapWithConcurrency(shortlist, 5, async ({ market, rankScore, trendingScore }) => {
    const { data: platform } = await getCoinPlatformDetail(market.id);
    const dexResult = platform.contractAddress
      ? await getDexDataByAddress(platform.contractAddress, platform.chain)
      : { data: null, meta: { status: "unavailable" as const, lastUpdated: null, source: "dexscreener" as const } };

    const scores = computeScores(market, dexResult.data, null);

    const reasons: DiscoveryReason[] = [];
    if (trendingScore !== null) reasons.push("trending");
    if ((scores.opportunity.score ?? 0) >= MOMENTUM_THRESHOLD) reasons.push("momentum");

    const pairAgeDays = daysSince(dexResult.data?.pairCreatedAt ?? null);
    const genesisAgeDays = daysSince(platform.genesisDate);
    const effectiveAge = pairAgeDays ?? genesisAgeDays;
    if (effectiveAge !== null && effectiveAge <= NEW_PAIR_MAX_AGE_DAYS) reasons.push("new_pair");

    if (reasons.length === 0) reasons.push("momentum"); // garante que a lista mostra sempre um motivo

    const def: TokenDefinition = {
      tokenKey: watchedTokenKey({ chain: platform.chain, address: platform.contractAddress, coingeckoId: market.id }),
      coingeckoId: market.id,
      symbol: market.symbol,
      name: market.name,
      chain: platform.chain,
      contractAddress: platform.contractAddress,
      riskTier: deriveRiskTier(market.marketCap),
      verified: true,
      note:
        "Nível de risco estimado por capitalização de mercado (heurística), não substitui o Risk Score detalhado abaixo.",
    };

    const record: DiscoveryRecord = {
      def,
      market,
      dex: dexResult.data,
      meta: { coingecko: universeMeta, dexscreener: dexResult.meta },
      scores,
      discovery: { reasons, rankScore, trendingScore },
    };
    return record;
  });

  enriched.sort((a, b) => b.discovery.rankScore - a.discovery.rankScore);

  return { records: enriched, universeSize: universe.length, meta: { coingecko: universeMeta } };
}

export type { MarketChart };
