import { NextResponse } from "next/server";
import { getDiscoveryFeed, DiscoveryRecord, mapWithConcurrency } from "@/lib/discovery";
import { listWatchedTokens } from "@/lib/tokenRegistry";
import { getMarkets } from "@/lib/coingecko";
import { getDexDataByAddress } from "@/lib/dexscreener";
import { computeScores } from "@/lib/scoring";
import { OpportunityResult } from "@/lib/opportunity";
import { OPPORTUNITY_CONFIG } from "@/lib/opportunityConfig";
import { deriveRiskTier } from "@/lib/discovery";
import { getStorage } from "@/lib/storage";
import { DexPairData, MarketData, TokenDefinition } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Se o estado persistido (escrito pelo job de monitorização) for mais velho
 * do que isto, uma oportunidade nunca é mostrada como "live" — mesmo que o
 * score bruto guardado seja alto (Fase 3 do hardening: freshness gate
 * também aplicado NA LEITURA, não só no momento em que o cron correu).
 */
function withReadTimeFreshness(opportunity: OpportunityResult | null, updatedAt: string): OpportunityResult | null {
  if (!opportunity) return null;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  if (ageMs <= OPPORTUNITY_CONFIG.freshness.maxLiveSnapshotAgeMs) return opportunity;
  if (opportunity.classification === "no_signal") return { ...opportunity, latestSnapshotAgeMs: ageMs };
  return {
    ...opportunity,
    classification: "no_signal",
    invalidatedByRisk: true,
    latestSnapshotAgeMs: ageMs,
    risks: [...opportunity.risks, "Market data is stale — live signal disabled"],
  };
}

export async function GET() {
  try {
    const storage = getStorage();
    const { records: discoveryRecords, universeSize, meta } = await getDiscoveryFeed();

    const discoveryByKey = new Map(discoveryRecords.map((r) => [r.def.tokenKey, r]));
    const watched = await listWatchedTokens();
    const manualOnly = watched.filter((t) => t.source === "manual" && !discoveryByKey.has(t.key));

    // Lê o estado persistido pelo job de monitorização — evita recalcular/repetir
    // pedidos às APIs externas a cada visita ao dashboard (Fase 11).
    const currentStates = await storage.listCurrentTokenStates();
    const stateByKey = new Map(currentStates.map((s) => [s.tokenKey, s]));

    // --- Tokens manuais ainda sem qualquer estado persistido: fetch pontual e limitado ---
    const manualNeedingFetch = manualOnly.filter((t) => !stateByKey.has(t.key));
    const manualIds = manualNeedingFetch.map((t) => t.coingeckoId).filter((id): id is string => Boolean(id));
    const manualMarkets = manualIds.length > 0 ? (await getMarkets(manualIds)).data : {};

    const manualRecords: DiscoveryRecord[] = await mapWithConcurrency(manualNeedingFetch, 5, async (t) => {
      const market = t.coingeckoId ? manualMarkets[t.coingeckoId] ?? null : null;
      const dexRes = t.contractAddress
        ? await getDexDataByAddress(t.contractAddress, t.chain)
        : { data: null, meta: { status: "unavailable" as const, lastUpdated: null, source: "dexscreener" as const } };

      const def: TokenDefinition = {
        tokenKey: t.key,
        coingeckoId: t.coingeckoId,
        symbol: t.symbol,
        name: t.name,
        chain: t.chain,
        contractAddress: t.contractAddress,
        riskTier: deriveRiskTier(market?.marketCap ?? null),
        verified: true,
        note: "Token adicionado manualmente. Ainda sem estado persistido pelo job de monitorização — dados obtidos agora mesmo.",
      };

      const scores = computeScores(market, dexRes.data, null);

      const record: DiscoveryRecord = {
        def,
        market,
        dex: dexRes.data,
        meta: { coingecko: meta.coingecko, dexscreener: dexRes.meta },
        scores,
        discovery: { reasons: [], rankScore: 0, trendingScore: null },
      };
      return record;
    });

    const allRecords: DiscoveryRecord[] = [...discoveryRecords, ...manualRecords, ...manualOnly.filter((t) => stateByKey.has(t.key)).map((t) => {
      const state = stateByKey.get(t.key)!;
      const market = (state.marketRaw as MarketData | null) ?? null;
      const dex = (state.dexRaw as DexPairData | null) ?? null;
      const def: TokenDefinition = {
        tokenKey: t.key,
        coingeckoId: t.coingeckoId,
        symbol: t.symbol,
        name: t.name,
        chain: t.chain,
        contractAddress: t.contractAddress,
        riskTier: deriveRiskTier(market?.marketCap ?? null),
        verified: true,
        note: "Token adicionado manualmente e verificado pelo utilizador através do endereço do contrato.",
      };
      const scores = computeScores(market, dex, null);
      const record: DiscoveryRecord = {
        def,
        market,
        dex,
        meta: {
          coingecko: { status: "live", lastUpdated: state.updatedAt, source: "coingecko" },
          dexscreener: { status: "live", lastUpdated: state.updatedAt, source: "dexscreener" },
        },
        scores,
        discovery: { reasons: [], rankScore: 0, trendingScore: null },
      };
      return record;
    })];

    // --- Anexa o Opportunity Score, preferindo o estado persistido (Fase 11) ---
    const withOpportunity = allRecords.map((r) => {
      const state = stateByKey.get(r.def.tokenKey);
      if (state) {
        const opportunity = withReadTimeFreshness(state.opportunityRaw as OpportunityResult | null, state.updatedAt);
        return { ...r, opportunity };
      }
      return { ...r, opportunity: null };
    });

    const liveOpportunities = withOpportunity
      .filter((r) => r.opportunity && r.opportunity.classification !== "no_signal")
      .sort((a, b) => (b.opportunity?.total ?? 0) - (a.opportunity?.total ?? 0));

    const monitorHealth = await storage.getMonitorHealth();

    return NextResponse.json({
      records: withOpportunity,
      liveOpportunities,
      universeSize,
      generatedAt: new Date().toISOString(),
      meta,
      storage: storage.kind,
      monitorHealth,
    });
  } catch {
    return NextResponse.json(
      {
        records: [],
        liveOpportunities: [],
        universeSize: 0,
        generatedAt: new Date().toISOString(),
        meta: { coingecko: { status: "unavailable", lastUpdated: null, source: "coingecko" } },
        storage: "memory",
        monitorHealth: null,
        error: "Falha ao gerar a lista de descoberta.",
      },
      { status: 200 }
    );
  }
}
