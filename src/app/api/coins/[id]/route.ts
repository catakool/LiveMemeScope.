import { NextRequest, NextResponse } from "next/server";
import { getMarkets, getMarketChart, getCoinPlatformDetail } from "@/lib/coingecko";
import { getDexDataByAddress } from "@/lib/dexscreener";
import { computeScores } from "@/lib/scoring";
import { computeOpportunity } from "@/lib/opportunity";
import { deriveRiskTier } from "@/lib/discovery";
import { getStorage } from "@/lib/storage";
import { parseTokenKey, watchedTokenKey } from "@/lib/tokenKey";
import { listWatchedTokens } from "@/lib/tokenRegistry";
import { Chain, SourceMeta, TokenDefinition } from "@/lib/types";

export const dynamic = "force-dynamic";
const OPPORTUNITY_SNAPSHOT_LOOKBACK_MS = 90 * 60_000;

/**
 * Aceita, no parâmetro de rota, uma tokenKey (`chain:endereço` ou
 * `cg:coingeckoId`) ou, por compatibilidade, um coingeckoId "nu". NUNCA
 * devolve 404 apenas porque um token adicionado manualmente não existe na
 * CoinGecko — nesse caso mostra apenas o que a DexScreener e os snapshots
 * próprios têm (Fase 1 do hardening).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { searchParams } = new URL(req.url);
  const days = searchParams.get("days") ?? "30";

  // 1) Se o token já estiver no registo (manual ou descoberta), essa é a fonte de verdade da identidade.
  const watched = await listWatchedTokens();
  const registryHit = watched.find((t) => t.key === id);

  let chain: Chain | null = registryHit?.chain ?? null;
  let contractAddress: string | null = registryHit?.contractAddress ?? null;
  let coingeckoId: string | null = registryHit?.coingeckoId ?? null;

  if (!registryHit) {
    const parsed = parseTokenKey(id);
    chain = parsed.chain;
    contractAddress = parsed.address;
    coingeckoId = parsed.coingeckoId;
  }

  // A dashboard may already know the CoinGecko identity even when tokenKey is
  // chain:address. Accept that identity only after verifying that CoinGecko
  // resolves to the SAME contract address. This prevents symbol/name matching
  // from opening an unrelated token.
  const cgHint = searchParams.get("cg")?.trim() || null;
  if (!coingeckoId && cgHint) {
    try {
      const hintedPlatform = await getCoinPlatformDetail(cgHint);
      const hintedAddress = hintedPlatform.data.contractAddress?.toLowerCase() ?? null;
      const expectedAddress = contractAddress?.toLowerCase() ?? null;
      if (hintedAddress && expectedAddress && hintedAddress === expectedAddress) {
        coingeckoId = cgHint;
        chain = chain ?? hintedPlatform.data.chain;
      }
    } catch {
      // Ignore an unverifiable hint; DexScreener/persisted data remain usable.
    }
  }

  // 2) Dados da CoinGecko, só se tivermos um coingeckoId.
  let market = null;
  let cgMeta: SourceMeta = { status: "unavailable", lastUpdated: null, source: "coingecko" };
  let chart = null;
  let chartMeta: SourceMeta = { status: "unavailable", lastUpdated: null, source: "coingecko" };

  if (coingeckoId) {
    const [marketsRes, chartRes] = await Promise.all([
      getMarkets([coingeckoId]),
      getMarketChart(coingeckoId, days === "max" ? "max" : Number(days)),
    ]);
    market = marketsRes.data[coingeckoId] ?? null;
    cgMeta = marketsRes.meta;
    chart = chartRes.data;
    chartMeta = chartRes.meta;

    // Se não sabíamos a chain/contrato ainda, tentamos completá-los a partir da própria CoinGecko.
    if (!chain || !contractAddress) {
      const platformRes = await getCoinPlatformDetail(coingeckoId);
      chain = chain ?? platformRes.data.chain;
      contractAddress = contractAddress ?? platformRes.data.contractAddress;
    }
  }

  // 3) Dados on-chain da DexScreener, só se tivermos endereço de contrato.
  const dexRes = contractAddress
    ? await getDexDataByAddress(contractAddress, chain ?? undefined)
    : { data: null, meta: { status: "unavailable" as const, lastUpdated: null, source: "dexscreener" as const } };

  // 4) Sem NENHUM dado (nem mercado nem on-chain): tentar o último estado persistido antes de desistir.
  if (!market && !dexRes.data) {
    const storage = getStorage();
    const tokenKey = registryHit?.key ?? id;
    const state = await storage.getCurrentTokenState(tokenKey);
    if (!state) {
      return NextResponse.json(
        {
          error:
            "Não há dados disponíveis para este token ainda (nem CoinGecko, nem DexScreener, nem histórico próprio). " +
            "Se acabou de o adicionar manualmente, aguarde a próxima execução do job de monitorização.",
        },
        { status: 404 }
      );
    }
    // Usa o último estado persistido, claramente identificado como possivelmente desatualizado.
    market = (state.marketRaw as typeof market) ?? null;
    const dexFromState = state.dexRaw as typeof dexRes.data;
    dexRes.data = dexFromState ?? null;
    dexRes.meta = { status: "stale", lastUpdated: state.updatedAt, source: "dexscreener" };
  }

  const resolvedChain: Chain = chain ?? dexRes.data?.chain ?? "unknown";
  const tokenKey = registryHit?.key ?? watchedTokenKey({ chain: resolvedChain, address: contractAddress, coingeckoId });

  const def: TokenDefinition = {
    tokenKey,
    coingeckoId,
    symbol: registryHit?.symbol ?? market?.symbol ?? "TOKEN",
    name: registryHit?.name ?? market?.name ?? (coingeckoId ? coingeckoId : "Token DEX"),
    chain: resolvedChain,
    contractAddress,
    riskTier: deriveRiskTier(market?.marketCap ?? null),
    verified: true,
    note: coingeckoId
      ? "Nível de risco estimado por capitalização de mercado (heurística), não substitui o Risk Score detalhado abaixo."
      : "Token sem listagem na CoinGecko — dados apenas da DexScreener e do histórico próprio (sem gráfico histórico de longo prazo).",
  };

  const scores = computeScores(market, dexRes.data, chart);

  const storage = getStorage();
  let opportunity = null;
  try {
    const snapshots = await storage.getRecentSnapshots(tokenKey, Date.now() - OPPORTUNITY_SNAPSHOT_LOOKBACK_MS);
    if (snapshots.length > 0) {
      opportunity = computeOpportunity(snapshots, market, dexRes.data, []);
    }
  } catch {
    opportunity = null;
  }

  const signals = await storage.getRecentSignals(tokenKey, 20).catch(() => []);

  return NextResponse.json({
    def,
    market,
    dex: dexRes.data,
    chart,
    scores,
    opportunity,
    signals,
    meta: {
      coingecko: cgMeta,
      dexscreener: dexRes.meta,
      chart: chartMeta,
    },
  });
}
