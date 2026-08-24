import { NextResponse } from "next/server";
import { getDiscoveryFeed, DiscoveryRecord, mapWithConcurrency } from "@/lib/discovery";
import { listWatchedTokens } from "@/lib/tokenRegistry";
import { getMarkets } from "@/lib/coingecko";
import { getDexDataByAddress } from "@/lib/dexscreener";
import { computeScores } from "@/lib/scoring";
import { computeOpportunity } from "@/lib/opportunity";
import { deriveRiskTier } from "@/lib/discovery";
import { getStorage, watchedTokenKey } from "@/lib/storage";
import { TokenDefinition } from "@/lib/types";

export const dynamic = "force-dynamic";

const OPPORTUNITY_SNAPSHOT_LOOKBACK_MS = 90 * 60_000;

export async function GET() {
  try {
    const { records: discoveryRecords, universeSize, meta } = await getDiscoveryFeed();

    // --- Une os tokens adicionados manualmente que ainda não estão no Discovery Feed ---
    const discoveryKeys = new Set(
      discoveryRecords.map((r) =>
        watchedTokenKey({ chain: r.def.chain, address: r.def.contractAddress, coingeckoId: r.def.coingeckoId })
      )
    );
    const watched = await listWatchedTokens();
    const manualOnly = watched.filter((t) => t.source === "manual" && !discoveryKeys.has(t.key));

    const manualIds = manualOnly.map((t) => t.coingeckoId).filter((id): id is string => Boolean(id));
    const manualMarkets = manualIds.length > 0 ? (await getMarkets(manualIds)).data : {};

    const manualRecords: DiscoveryRecord[] = await mapWithConcurrency(manualOnly, 5, async (t) => {
      const market = t.coingeckoId ? manualMarkets[t.coingeckoId] ?? null : null;
      const dexRes = t.contractAddress
        ? await getDexDataByAddress(t.contractAddress, t.chain)
        : { data: null, meta: { status: "unavailable" as const, lastUpdated: null, source: "dexscreener" as const } };

      const def: TokenDefinition = {
        coingeckoId: t.coingeckoId ?? t.key,
        symbol: t.symbol,
        name: t.name,
        chain: t.chain,
        contractAddress: t.contractAddress,
        riskTier: deriveRiskTier(market?.marketCap ?? null),
        verified: true,
        note: "Token adicionado manualmente e verificado pelo utilizador através do endereço do contrato.",
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

    const allRecords: DiscoveryRecord[] = [...discoveryRecords, ...manualRecords];

    // --- Anexa o Opportunity Score (lido do histórico já guardado; nunca chama APIs externas aqui) ---
    const storage = getStorage();
    const since = Date.now() - OPPORTUNITY_SNAPSHOT_LOOKBACK_MS;
    const withOpportunity = await mapWithConcurrency(allRecords, 8, async (r) => {
      const key = watchedTokenKey({ chain: r.def.chain, address: r.def.contractAddress, coingeckoId: r.def.coingeckoId });
      try {
        const snapshots = await storage.getRecentSnapshots(key, since);
        if (snapshots.length === 0) {
          return { ...r, opportunity: null };
        }
        const opportunity = computeOpportunity(snapshots, r.market, r.dex, []);
        return { ...r, opportunity };
      } catch {
        return { ...r, opportunity: null };
      }
    });

    const liveOpportunities = withOpportunity
      .filter((r) => r.opportunity && r.opportunity.classification !== "no_signal")
      .sort((a, b) => (b.opportunity?.total ?? 0) - (a.opportunity?.total ?? 0));

    return NextResponse.json({
      records: withOpportunity,
      liveOpportunities,
      universeSize,
      generatedAt: new Date().toISOString(),
      meta,
      storage: storage.kind,
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
        error: "Falha ao gerar a lista de descoberta.",
      },
      { status: 200 }
    );
  }
}
