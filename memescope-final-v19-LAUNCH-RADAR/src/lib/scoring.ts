import { CoinScores, DexPairData, MarketData, ScoreComponent, ScoreResult } from "./types";
import { MarketChart } from "./coingecko";

// ---------------------------------------------------------------------------
// MemeScope Scoring Engine
// ---------------------------------------------------------------------------
// Princípio: nunca inventar valores. Cada componente só entra no cálculo se
// houver dado real disponível. O peso dos componentes em falta é excluído do
// denominador (o score final é renormalizado pelos pesos disponíveis) e a
// "confiança" reportada é a fração do peso total coberta por dados reais.
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Mapeia uma variação percentual para 0-100, centrado em 50 quando a variação é 0%. */
function mapChangeToScore(change: number | null, capPercent: number): number | null {
  if (change === null || Number.isNaN(change)) return null;
  return clamp(50 + (change / capPercent) * 50, 0, 100);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function aggregate(components: ScoreComponent[]): ScoreResult {
  const totalWeight = components.reduce((a, c) => a + c.weight, 0);
  const availableWeight = components.reduce((a, c) => a + (c.available ? c.weight : 0), 0);
  const confidence = totalWeight > 0 ? availableWeight / totalWeight : 0;

  if (availableWeight === 0) {
    return { score: null, confidence: 0, components };
  }

  const weightedSum = components.reduce(
    (a, c) => a + (c.available && c.value !== null ? c.value * c.weight : 0),
    0
  );
  const score = clamp(weightedSum / availableWeight, 0, 100);
  return { score: Math.round(score * 10) / 10, confidence: Math.round(confidence * 100) / 100, components };
}

// ---------------------------------------------------------------------------
// Opportunity Score
// ---------------------------------------------------------------------------

export function computeOpportunityScore(
  market: MarketData | null,
  dex: DexPairData | null,
  chart: MarketChart | null
): ScoreResult {
  const components: ScoreComponent[] = [];

  const c1h = mapChangeToScore(market?.change1h ?? null, 8);
  components.push({
    key: "momentum1h",
    label: "Momentum 1h",
    weight: 0.08,
    value: c1h,
    available: c1h !== null,
  });

  const c24h = mapChangeToScore(market?.change24h ?? null, 25);
  components.push({
    key: "momentum24h",
    label: "Momentum 24h",
    weight: 0.15,
    value: c24h,
    available: c24h !== null,
  });

  const c7d = mapChangeToScore(market?.change7d ?? null, 60);
  components.push({
    key: "momentum7d",
    label: "Momentum 7d",
    weight: 0.13,
    value: c7d,
    available: c7d !== null,
  });

  const c30d = mapChangeToScore(market?.change30d ?? null, 150);
  components.push({
    key: "momentum30d",
    label: "Momentum 30d",
    weight: 0.09,
    value: c30d,
    available: c30d !== null,
  });

  // Crescimento de volume: compara o volume mais recente com a média do período no gráfico.
  let volumeGrowthScore: number | null = null;
  if (chart && chart.volumes.length >= 8) {
    const vols = chart.volumes.map((v) => v.volume);
    const last = vols[vols.length - 1];
    const prevAvg = mean(vols.slice(0, -1));
    if (prevAvg > 0) {
      const growthPct = ((last - prevAvg) / prevAvg) * 100;
      volumeGrowthScore = mapChangeToScore(growthPct, 100);
    }
  }
  components.push({
    key: "volumeGrowth",
    label: "Crescimento de volume",
    weight: 0.12,
    value: volumeGrowthScore,
    available: volumeGrowthScore !== null,
    detail: "Compara o volume mais recente com a média do período apresentado no gráfico.",
  });

  // Rácio volume/capitalização: demasiado baixo = sem interesse; demasiado alto = possível volume artificial.
  let volToMcapScore: number | null = null;
  if (market?.volume24h && market?.marketCap && market.marketCap > 0) {
    const ratio = market.volume24h / market.marketCap;
    // pico de pontuação perto de 0.15 (15% da capitalização transacionado em 24h)
    if (ratio <= 0.15) volToMcapScore = clamp((ratio / 0.15) * 100, 0, 100);
    else volToMcapScore = clamp(100 - ((ratio - 0.15) / 0.85) * 100, 0, 100);
  }
  components.push({
    key: "volumeToMcap",
    label: "Volume / Capitalização",
    weight: 0.1,
    value: volToMcapScore,
    available: volToMcapScore !== null,
  });

  // Crescimento de liquidez: exigiria snapshots históricos de liquidez que esta versão não guarda.
  components.push({
    key: "liquidityGrowth",
    label: "Crescimento de liquidez",
    weight: 0.08,
    value: null,
    available: false,
    detail: "Não disponível: requer snapshots históricos de liquidez ainda não recolhidos por esta instância.",
  });

  let buyersScore: number | null = null;
  if (dex?.txns24h?.buys !== null && dex?.txns24h?.buys !== undefined && dex?.txns24h?.sells !== null && dex?.txns24h?.sells !== undefined) {
    const total = dex.txns24h.buys + dex.txns24h.sells;
    if (total > 0) buyersScore = clamp((dex.txns24h.buys / total) * 100, 0, 100);
  }
  components.push({
    key: "buyersVsSellers",
    label: "Compradores vs. vendedores (24h)",
    weight: 0.1,
    value: buyersScore,
    available: buyersScore !== null,
  });

  // Consistência da tendência: baseada na regularidade dos retornos diários do gráfico.
  let consistencyScore: number | null = null;
  if (chart && chart.prices.length >= 8) {
    const prices = chart.prices.map((p) => p.price);
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    if (returns.length >= 4) {
      const avgAbs = mean(returns.map(Math.abs)) + 1e-9;
      const sd = stddev(returns);
      consistencyScore = clamp(100 * (1 - sd / (avgAbs * 2)), 0, 100);
    }
  }
  components.push({
    key: "trendConsistency",
    label: "Consistência da tendência",
    weight: 0.1,
    value: consistencyScore,
    available: consistencyScore !== null,
    detail: "Baseada na regularidade dos retornos diários (menos oscilação errática = pontuação mais alta).",
  });

  // Interesse social: sem fonte verificável integrada nesta versão.
  components.push({
    key: "socialInterest",
    label: "Interesse social",
    weight: 0.05,
    value: null,
    available: false,
    detail: "Não disponível: nenhuma fonte de dados sociais verificável está integrada nesta versão.",
  });

  return aggregate(components);
}

// ---------------------------------------------------------------------------
// Risk Score (quanto mais alto, mais arriscado)
// ---------------------------------------------------------------------------

export function computeRiskScore(
  market: MarketData | null,
  dex: DexPairData | null
): ScoreResult {
  const components: ScoreComponent[] = [];

  let lowLiquidityScore: number | null = null;
  const capForLiquidity = market?.marketCap ?? market?.fdv ?? null;
  if (dex?.liquidityUsd !== null && dex?.liquidityUsd !== undefined && capForLiquidity && capForLiquidity > 0) {
    const ratio = dex.liquidityUsd / capForLiquidity;
    lowLiquidityScore = clamp(100 - (ratio / 0.15) * 100, 0, 100);
  }
  components.push({
    key: "lowLiquidity",
    label: "Liquidez reduzida",
    weight: 0.15,
    value: lowLiquidityScore,
    available: lowLiquidityScore !== null,
  });

  components.push({
    key: "holderConcentration",
    label: "Concentração dos maiores detentores",
    weight: 0.12,
    value: null,
    available: false,
    detail: "Não disponível: requer dados on-chain de distribuição de holders não integrados nesta versão.",
  });

  let mcapFdvScore: number | null = null;
  if (market?.fdv && market.fdv > 0 && market?.marketCap !== null && market?.marketCap !== undefined) {
    const gap = (market.fdv - market.marketCap) / market.fdv;
    mcapFdvScore = clamp(gap * 100, 0, 100);
  }
  components.push({
    key: "mcapFdvGap",
    label: "Diferença entre capitalização e FDV",
    weight: 0.13,
    value: mcapFdvScore,
    available: mcapFdvScore !== null,
  });

  let ageScore: number | null = null;
  if (dex?.pairCreatedAt) {
    const ageDays = (Date.now() - new Date(dex.pairCreatedAt).getTime()) / 86_400_000;
    ageScore = clamp(100 - (ageDays / 180) * 100, 0, 100);
  }
  components.push({
    key: "tokenAge",
    label: "Idade do token",
    weight: 0.1,
    value: ageScore,
    available: ageScore !== null,
    detail: ageScore !== null ? undefined : "Não disponível: sem data de criação do par on-chain.",
  });

  components.push({
    key: "unlockedLiquidity",
    label: "Liquidez não bloqueada",
    weight: 0.08,
    value: null,
    available: false,
    detail: "Não disponível: o estado de bloqueio de liquidez não é exposto pelas APIs usadas nesta versão.",
  });

  components.push({
    key: "mintFreezeAuthority",
    label: "Autoridade de mint/freeze ativa",
    weight: 0.1,
    value: null,
    available: false,
    detail: "Não disponível: requer leitura direta on-chain (RPC específico da blockchain), não integrada nesta versão.",
  });

  components.push({
    key: "creatorWalletMovement",
    label: "Movimentos suspeitos da carteira do criador",
    weight: 0.08,
    value: null,
    available: false,
    detail: "Não disponível: requer rastreio on-chain da carteira do criador, não integrado nesta versão.",
  });

  components.push({
    key: "unverifiedContract",
    label: "Contrato não verificado",
    weight: 0.07,
    value: null,
    available: false,
    detail: "Não disponível: requer consulta ao explorador de blockchain específico (ex.: Etherscan/Solscan), não integrada nesta versão.",
  });

  let artificialVolumeScore: number | null = null;
  if (dex?.volume24hUsd !== null && dex?.volume24hUsd !== undefined && dex?.liquidityUsd && dex.liquidityUsd > 0) {
    const ratio = dex.volume24hUsd / dex.liquidityUsd;
    artificialVolumeScore = clamp(((ratio - 5) / 45) * 100, 0, 100);
  }
  components.push({
    key: "artificialVolume",
    label: "Possível volume artificial",
    weight: 0.09,
    value: artificialVolumeScore,
    available: artificialVolumeScore !== null,
    detail: "Heurística: rácio volume 24h / liquidez muito elevado pode indicar wash trading. Não é uma deteção definitiva.",
  });

  components.push({
    key: "honeypotAbnormalFees",
    label: "Possível honeypot ou taxas anormais",
    weight: 0.03,
    value: null,
    available: false,
    detail: "Não disponível: requer simulação de venda (ex.: honeypot.is), não integrada nesta versão.",
  });

  let volatilityScore: number | null = null;
  if (market?.change1h !== null && market?.change1h !== undefined || market?.change24h !== null && market?.change24h !== undefined) {
    const drop1h = market?.change1h !== null && market?.change1h !== undefined ? Math.max(0, -market.change1h) : 0;
    const drop24h = market?.change24h !== null && market?.change24h !== undefined ? Math.max(0, -market.change24h) : 0;
    volatilityScore = clamp(drop1h * 6 + drop24h * 1.5, 0, 100);
  }
  components.push({
    key: "abruptDropsVolatility",
    label: "Quedas abruptas / volatilidade",
    weight: 0.05,
    value: volatilityScore,
    available: volatilityScore !== null,
    detail: "Heurística baseada nas variações negativas recentes de preço (1h e 24h), não num histórico completo de drawdown.",
  });

  return aggregate(components);
}

export function computeScores(
  market: MarketData | null,
  dex: DexPairData | null,
  chart: MarketChart | null
): CoinScores {
  return {
    opportunity: computeOpportunityScore(market, dex, chart),
    risk: computeRiskScore(market, dex),
  };
}
