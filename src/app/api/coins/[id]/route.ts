import { NextRequest, NextResponse } from "next/server";
import { getMarkets, getMarketChart, getCoinPlatformDetail } from "@/lib/coingecko";
import { getDexDataByAddress } from "@/lib/dexscreener";
import { computeScores } from "@/lib/scoring";
import { computeOpportunity } from "@/lib/opportunity";
import { deriveRiskTier } from "@/lib/discovery";
import { getStorage, watchedTokenKey } from "@/lib/storage";
import { TokenDefinition } from "@/lib/types";

export const dynamic = "force-dynamic";
const OPPORTUNITY_SNAPSHOT_LOOKBACK_MS = 90 * 60_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { searchParams } = new URL(req.url);
  const days = searchParams.get("days") ?? "30";

  const [{ data: markets, meta: cgMeta }, platformRes, chartRes] = await Promise.all([
    getMarkets([id]),
    getCoinPlatformDetail(id),
    getMarketChart(id, days === "max" ? "max" : Number(days)),
  ]);

  const market = markets[id] ?? null;
  if (!market) {
    return NextResponse.json({ error: "Moeda não encontrada na CoinGecko." }, { status: 404 });
  }

  const platform = platformRes.data;
  const dexRes = platform.contractAddress
    ? await getDexDataByAddress(platform.contractAddress, platform.chain)
    : { data: null, meta: { status: "unavailable" as const, lastUpdated: null, source: "dexscreener" as const } };

  const scores = computeScores(market, dexRes.data, chartRes.data);

  const def: TokenDefinition = {
    coingeckoId: id,
    symbol: market.symbol,
    name: market.name,
    chain: platform.chain,
    contractAddress: platform.contractAddress,
    riskTier: deriveRiskTier(market.marketCap),
    verified: true,
    note: "Nível de risco estimado por capitalização de mercado (heurística), não substitui o Risk Score detalhado abaixo.",
  };

  const storage = getStorage();
  const key = watchedTokenKey({ chain: def.chain, address: def.contractAddress, coingeckoId: id });
  let opportunity = null;
  try {
    const snapshots = await storage.getRecentSnapshots(key, Date.now() - OPPORTUNITY_SNAPSHOT_LOOKBACK_MS);
    if (snapshots.length > 0) {
      opportunity = computeOpportunity(snapshots, market, dexRes.data, []);
    }
  } catch {
    opportunity = null;
  }

  const signals = await storage.getRecentSignals(key, 20).catch(() => []);

  return NextResponse.json({
    def,
    market,
    dex: dexRes.data,
    chart: chartRes.data,
    scores,
    opportunity,
    signals,
    meta: {
      coingecko: cgMeta,
      dexscreener: dexRes.meta,
      chart: chartRes.meta,
    },
  });
}
