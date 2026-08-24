import { NextRequest, NextResponse } from "next/server";
import { getMarkets, getMarketChart, getCoinPlatformDetail } from "@/lib/coingecko";
import { getDexDataByAddress } from "@/lib/dexscreener";
import { computeScores } from "@/lib/scoring";
import { deriveRiskTier } from "@/lib/discovery";
import { TokenDefinition } from "@/lib/types";

export const dynamic = "force-dynamic";

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

  return NextResponse.json({
    def,
    market,
    dex: dexRes.data,
    chart: chartRes.data,
    scores,
    meta: {
      coingecko: cgMeta,
      dexscreener: dexRes.meta,
      chart: chartRes.meta,
    },
  });
}
