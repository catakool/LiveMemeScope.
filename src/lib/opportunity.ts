import { DexPairData, MarketData } from "./types";
import { Snapshot } from "./storage/types";
import { CatalystSignal } from "./catalystProvider";
import { OPPORTUNITY_CONFIG } from "./opportunityConfig";
import { evaluateOpportunityRiskGates } from "./riskGates";

// ---------------------------------------------------------------------------
// MemeScope Opportunity Engine (revisto na fase de hardening)
// ---------------------------------------------------------------------------
// Módulo SEPARADO de scoring.ts. Analisa a SÉRIE TEMPORAL de snapshots para
// detetar ACELERAÇÃO — mudança de comportamento normal para extraordinário —
// usando segmentos temporais NÃO sobrepostos (ver secção "Momentum" abaixo),
// não apenas "está a subir".
//
// Princípios:
//  - nunca inventar valores: componente sem dados reais = null + available:false;
//  - confidence é a fração do peso coberta por dados reais, nunca igual ao score;
//  - segurança > momentum: os Risk Gates (lib/riskGates.ts) podem invalidar a
//    classificação mesmo com um score bruto elevado;
//  - todos os limiares/pesos vivem em lib/opportunityConfig.ts, não espalhados
//    pelo código.
// ---------------------------------------------------------------------------

const CFG = OPPORTUNITY_CONFIG;

export type OpportunityClassification =
  | "very_strong_opportunity"
  | "strong_opportunity"
  | "high_momentum_watch"
  | "watch"
  | "no_signal";

export const CLASSIFICATION_LABEL: Record<OpportunityClassification, string> = {
  very_strong_opportunity: "Very Strong Opportunity",
  strong_opportunity: "Strong Opportunity",
  high_momentum_watch: "High Momentum / Watch",
  watch: "Watch",
  no_signal: "No Signal",
};

export type AsymmetryPotential = "low" | "medium" | "high" | "very_high";

export interface OpportunityComponents {
  momentum: number | null;
  volumeAcceleration: number | null;
  buyImbalance: number | null;
  liquidityQuality: number | null;
  marketStructure: number | null;
  catalyst: number | null;
}

export interface OpportunityResult {
  total: number | null;
  components: OpportunityComponents;
  confidence: number;
  reasons: string[];
  risks: string[];
  classification: OpportunityClassification;
  invalidatedByRisk: boolean;
  /** Idade do snapshot mais recente usado — a UI deve mostrar "Last snapshot: Xmin ago". */
  latestSnapshotAgeMs: number;
  /**
   * Potencial de assimetria (capitalização pequena = maior espaço para
   * movimentos percentuais grandes) — informativo, NÃO soma ao score
   * principal (ver Fase 8: market cap pequeno deixou de ser recompensado).
   */
  asymmetryPotential: AsymmetryPotential | null;
  metrics: {
    // Mantidos para a UI (retornos cumulativos desde "agora"), mas o cálculo
    // do score usa os segmentos não sobrepostos abaixo, não estes valores.
    change5m: number | null;
    change15m: number | null;
    change1h: number | null;
    // Segmentos não sobrepostos (Fase 4)
    recentVelocity: number | null; // %/min nos últimos 5min
    previousVelocity: number | null; // %/min no segmento 5-15min atrás
    accelerationRatio: number | null; // recentVelocity / previousVelocity
    // Volume (Fase 6)
    volumeRatio: number | null;
    baselineVolumeM5: number | null;
    volumeAnomalyStrength: number | null; // z-score robusto (MAD)
    // Buy/sell (Fase 7)
    buySellRatio: number | null;
    buySellSampleSize: number | null;
    // Auxiliar, nunca usado no score — cruzamento com o priceChange.m5 da própria DexScreener
    dexPriceChangeM5: number | null;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function mapChangeToScore(change: number | null, capPercent: number): number | null {
  if (change === null || Number.isNaN(change)) return null;
  return clamp(50 + (change / capPercent) * 50, 0, 100);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Desvio absoluto mediano (MAD) — dispersão robusta, pouco sensível a outliers. */
function mad(xs: number[], med: number): number {
  if (xs.length === 0) return 0;
  return median(xs.map((x) => Math.abs(x - med)));
}

function findSnapshotNear(snapshots: Snapshot[], nowMs: number, targetAgoMs: number, toleranceMs: number): Snapshot | null {
  const targetTs = nowMs - targetAgoMs;
  let best: Snapshot | null = null;
  let bestDiff = Infinity;
  for (const s of snapshots) {
    const diff = Math.abs(s.timestamp - targetTs);
    if (diff <= toleranceMs && diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

function pctChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

function velocityPercentPerMinute(changePercent: number | null, fromTs: number | null, toTs: number | null): number | null {
  if (changePercent === null || fromTs === null || toTs === null || toTs <= fromTs) return null;
  const minutes = (toTs - fromTs) / 60_000;
  return minutes > 0 ? changePercent / minutes : null;
}

// ---------------------------------------------------------------------------
// A) Momentum — segmentos temporais NÃO sobrepostos (Fase 4)
// ---------------------------------------------------------------------------
interface MomentumResult {
  score: number | null;
  available: boolean;
  change5m: number | null;
  change15m: number | null;
  change1h: number | null;
  recentVelocity: number | null;
  previousVelocity: number | null;
  accelerationRatio: number | null;
  reasons: string[];
}

function computeMomentum(snapshots: Snapshot[], latest: Snapshot): MomentumResult {
  const now = latest.timestamp;
  const { recent, mid, long } = CFG.momentum.segmentBoundariesMs;
  const tol = CFG.momentum.snapshotToleranceMs;

  const s5m = findSnapshotNear(snapshots, now, recent, tol);
  const s15m = findSnapshotNear(snapshots, now, mid, tol);
  const s1h = findSnapshotNear(snapshots, now, long, tol);

  // Retornos cumulativos desde "agora" — só para exibição na UI.
  const change5m = s5m ? pctChange(s5m.price, latest.price) : null;
  const change15m = s15m ? pctChange(s15m.price, latest.price) : null;
  const change1h = s1h ? pctChange(s1h.price, latest.price) : null;

  // Segmentos NÃO sobrepostos: R0=[now-5m,now], R1=[now-15m,now-5m], R2=[now-60m,now-15m].
  const r0 = s5m ? pctChange(s5m.price, latest.price) : null; // últimos 5min
  const r1 = s5m && s15m ? pctChange(s15m.price, s5m.price) : null; // 5-15min atrás
  const r2 = s15m && s1h ? pctChange(s1h.price, s15m.price) : null; // 15-60min atrás

  // Usa a duração REAL entre snapshots; o ponto mais próximo pode estar a 4m ou 6m do alvo.
  const recentVelocity = velocityPercentPerMinute(r0, s5m?.timestamp ?? null, latest.timestamp);
  const midVelocity = velocityPercentPerMinute(r1, s15m?.timestamp ?? null, s5m?.timestamp ?? null);
  const longVelocity = velocityPercentPerMinute(r2, s1h?.timestamp ?? null, s15m?.timestamp ?? null);
  const previousVelocity = midVelocity ?? longVelocity;

  const accelerationRatio =
    recentVelocity !== null && previousVelocity !== null && previousVelocity !== 0
      ? recentVelocity / previousVelocity
      : null;

  if (r0 === null) {
    // Sem sequer o segmento mais recente, não há momentum que calcular com confiança.
    return {
      score: null,
      available: false,
      change5m,
      change15m,
      change1h,
      recentVelocity,
      previousVelocity,
      accelerationRatio,
      reasons: [],
    };
  }

  let score = mapChangeToScore(r0, CFG.momentum.capPercent.recent) ?? 50;
  const reasons: string[] = [];

  if (recentVelocity !== null && previousVelocity !== null) {
    const sameSign = Math.sign(recentVelocity) === Math.sign(previousVelocity) || previousVelocity === 0;
    const accelerating = recentVelocity > 0 && sameSign && Math.abs(recentVelocity) > Math.abs(previousVelocity) * 1.3;
    const decelerating = Math.abs(recentVelocity) < Math.abs(previousVelocity) * 0.6 || (recentVelocity < 0 && previousVelocity > 0);

    if (accelerating && longVelocity !== null ? Math.abs(previousVelocity) > Math.abs(longVelocity) * 0.8 || longVelocity === null : accelerating) {
      score = clamp(score + 15, 0, 100);
      reasons.push("Aceleração de preço: a velocidade recente é claramente maior que a anterior (segmentos não sobrepostos)");
    } else if (decelerating) {
      score = clamp(score - 12, 0, 100);
      reasons.push("Desaceleração: a velocidade recente é menor que a do segmento anterior, apesar do retorno acumulado");
    }
  }

  return {
    score: Math.round(score * 10) / 10,
    available: true,
    change5m,
    change15m,
    change1h,
    recentVelocity,
    previousVelocity,
    accelerationRatio,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// B) Volume acceleration — baseline robusta com mediana + MAD (Fase 6)
// ---------------------------------------------------------------------------
function equivalentHourlyRate(s: Snapshot): number | null {
  if (s.volumeM5 !== null) return s.volumeM5 * 12;
  if (s.volumeH1 !== null) return s.volumeH1;
  if (s.volumeH6 !== null) return s.volumeH6 / 6;
  if (s.volumeH24 !== null) return s.volumeH24 / 24;
  return null;
}

interface VolumeResult {
  score: number | null;
  available: boolean;
  ratio: number | null;
  baselineVolumeM5: number | null;
  anomalyStrength: number | null;
  reason: string | null;
}

function computeVolumeAcceleration(snapshots: Snapshot[], latest: Snapshot): VolumeResult {
  const rateNow = equivalentHourlyRate(latest);
  if (rateNow === null) return { score: null, available: false, ratio: null, baselineVolumeM5: null, anomalyStrength: null, reason: null };

  const now = latest.timestamp;
  const baselineSnapshots = snapshots.filter(
    (s) => s.timestamp <= now - CFG.volume.baselineWindowEndMs && s.timestamp >= now - CFG.volume.baselineWindowStartMs
  );
  // volume.m5 é uma janela móvel; snapshots adjacentes partilham transações.
  // Um bucket de 5min reduz pseudo-amostras correlacionadas no baseline.
  const bucketed = new Map<number, Snapshot>();
  for (const s of baselineSnapshots) {
    const bucket = Math.floor(s.timestamp / CFG.volume.baselineSampleSpacingMs);
    const current = bucketed.get(bucket);
    if (!current || s.timestamp > current.timestamp) bucketed.set(bucket, s);
  }
  const rates = [...bucketed.values()].map(equivalentHourlyRate).filter((r): r is number => r !== null);

  if (rates.length < CFG.volume.minimumBaselineSamples) {
    return { score: null, available: false, ratio: null, baselineVolumeM5: null, anomalyStrength: null, reason: null };
  }

  const baseline = median(rates);
  if (baseline <= 0) return { score: null, available: false, ratio: null, baselineVolumeM5: null, anomalyStrength: null, reason: null };

  const deviation = mad(rates, baseline);
  const anomalyStrength = deviation > 0 ? (0.6745 * (rateNow - baseline)) / deviation : null;

  const ratio = rateNow / baseline;
  const capRatio = CFG.volume.ratioForMaxScore;
  const score = ratio >= 1 ? clamp(50 + (50 * Math.log2(ratio)) / Math.log2(capRatio), 0, 100) : clamp(50 * ratio, 0, 50);
  const reason = ratio >= 3 ? `Volume ${ratio.toFixed(1)}x acima da mediana histórica deste token` : null;

  return {
    score: Math.round(score * 10) / 10,
    available: true,
    ratio: Math.round(ratio * 100) / 100,
    baselineVolumeM5: Math.round((baseline / 12) * 100) / 100,
    anomalyStrength: anomalyStrength !== null ? Math.round(anomalyStrength * 100) / 100 : null,
    reason,
  };
}

// ---------------------------------------------------------------------------
// C) Transaction Buy Imbalance — antigo "buy pressure", com shrinkage (Fase 7)
// ---------------------------------------------------------------------------
interface BuyImbalanceResult {
  score: number | null;
  available: boolean;
  rawRatio: number | null;
  sampleSize: number | null;
  reason: string | null;
}

function shrinkageStrength(n: number): number {
  const cfg = CFG.buyImbalance;
  if (n < cfg.moderateConfidenceSampleSize) return 20; // shrinkage forte
  if (n < cfg.highConfidenceSampleSize) return 8; // shrinkage moderado
  return 2; // shrinkage fraco, confiança alta
}

function computeBuyImbalance(latest: Snapshot): BuyImbalanceResult {
  const windows: { buys: number | null; sells: number | null }[] = [
    { buys: latest.buysM5, sells: latest.sellsM5 },
    { buys: latest.buysH1, sells: latest.sellsH1 },
    { buys: latest.buysH6, sells: latest.sellsH6 },
    { buys: latest.buysH24, sells: latest.sellsH24 },
  ];
  for (const w of windows) {
    if (w.buys !== null && w.sells !== null) {
      const n = w.buys + w.sells;
      const rawRatio = n > 0 ? w.buys / n : null;
      if (n < CFG.buyImbalance.minimumSampleSize) {
        // Amostra pequena demais: não entra no score, mas devolvemos o rácio bruto para a UI.
        return { score: null, available: false, rawRatio, sampleSize: n, reason: null };
      }
      const k = shrinkageStrength(n);
      const shrunk = (w.buys + k * 0.5) / (n + k);
      const score = clamp(shrunk * 100, 0, 100);
      const reason = shrunk > 0.65 ? "Predomínio de compras sobre vendas, mesmo após ajuste pela amostra" : null;
      return { score: Math.round(score * 10) / 10, available: true, rawRatio: Math.round((rawRatio ?? 0) * 100) / 100, sampleSize: n, reason };
    }
  }
  return { score: null, available: false, rawRatio: null, sampleSize: null, reason: null };
}

// ---------------------------------------------------------------------------
// D) Liquidity quality — função gradual, sem descontinuidades (Fase 9)
// ---------------------------------------------------------------------------
function liquidityAbsoluteScore(liquidityUsd: number): number {
  const { critical, veryLow, low, healthy } = CFG.liquidity;
  if (liquidityUsd <= critical) return 0;
  if (liquidityUsd <= veryLow) return ((liquidityUsd - critical) / (veryLow - critical)) * 25;
  if (liquidityUsd <= low) return 25 + ((liquidityUsd - veryLow) / (low - veryLow)) * 30;
  if (liquidityUsd <= healthy) return 55 + ((liquidityUsd - low) / (healthy - low)) * 30;
  // acima do saudável, satura suavemente até 100 (3x o saudável já dá praticamente 100)
  const excess = clamp((liquidityUsd - healthy) / (healthy * 2), 0, 1);
  return 85 + excess * 15;
}

function computeLiquidityQuality(latest: Snapshot): { score: number | null; available: boolean } {
  if (latest.liquidityUsd === null) return { score: null, available: false };

  const absScore = liquidityAbsoluteScore(latest.liquidityUsd);

  if (latest.marketCap && latest.marketCap > 0) {
    const ratio = latest.liquidityUsd / latest.marketCap;
    const ratioScore = clamp((ratio / 0.15) * 100, 0, 100);
    const combined = absScore * 0.6 + ratioScore * 0.4;
    return { score: Math.round(combined * 10) / 10, available: true };
  }

  return { score: Math.round(absScore * 10) / 10, available: true };
}

// ---------------------------------------------------------------------------
// E) Market structure — idade/maturidade, SEM recompensar microcap (Fase 8)
// ---------------------------------------------------------------------------
function computeMarketStructure(
  latest: Snapshot,
  pairCreatedAt: string | null
): { score: number | null; available: boolean; ageDays: number | null } {
  let ageDays: number | null = null;
  let ageScore: number | null = null;

  if (pairCreatedAt) {
    ageDays = (Date.now() - new Date(pairCreatedAt).getTime()) / 86_400_000;
    if (ageDays < CFG.marketStructure.veryNewTokenAgeDays) ageScore = 30;
    else if (ageDays < CFG.marketStructure.establishedTokenAgeDays) ageScore = 90;
    else ageScore = 70;
  }

  if (ageScore === null) return { score: null, available: false, ageDays };

  // Penalização de fragilidade: capitalização muito pequena + liquidez fraca ao mesmo tempo
  // (não é uma recompensa por ser pequeno — é uma penalização quando pequeno E frágil).
  let fragilityPenalty = 0;
  if (latest.marketCap !== null && latest.marketCap < 1_000_000 && latest.liquidityUsd !== null && latest.liquidityUsd < CFG.liquidity.low) {
    fragilityPenalty = 20;
  }

  const score = clamp(ageScore - fragilityPenalty, 0, 100);
  return { score: Math.round(score * 10) / 10, available: true, ageDays };
}

function computeAsymmetryPotential(marketCap: number | null): AsymmetryPotential | null {
  if (marketCap === null) return null;
  if (marketCap < 1_000_000) return "very_high";
  if (marketCap < 10_000_000) return "high";
  if (marketCap < 100_000_000) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// F) Catalyst — sempre indisponível nesta versão (ver catalystProvider.ts)
// ---------------------------------------------------------------------------
function computeCatalyst(signals: CatalystSignal[]): { score: number | null; available: boolean; reasons: string[] } {
  if (signals.length === 0) return { score: null, available: false, reasons: [] };
  const score = clamp(signals.reduce((a, s) => a + s.weight, 0) / signals.length, 0, 100);
  return { score, available: true, reasons: signals.map((s) => `${s.label} (${s.source})`) };
}

// ---------------------------------------------------------------------------
// Motor principal
// ---------------------------------------------------------------------------
export function computeOpportunity(
  snapshots: Snapshot[],
  market: MarketData | null,
  dex: DexPairData | null,
  catalysts: CatalystSignal[] = []
): OpportunityResult {
  const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);
  const latest = sorted[sorted.length - 1];

  const emptyMetrics: OpportunityResult["metrics"] = {
    change5m: null,
    change15m: null,
    change1h: null,
    recentVelocity: null,
    previousVelocity: null,
    accelerationRatio: null,
    volumeRatio: null,
    baselineVolumeM5: null,
    volumeAnomalyStrength: null,
    buySellRatio: null,
    buySellSampleSize: null,
    dexPriceChangeM5: dex?.priceChangeM5 ?? null,
  };

  if (!latest) {
    return {
      total: null,
      components: {
        momentum: null,
        volumeAcceleration: null,
        buyImbalance: null,
        liquidityQuality: null,
        marketStructure: null,
        catalyst: null,
      },
      confidence: 0,
      reasons: [],
      risks: ["Ainda sem histórico suficiente — este token acabou de começar a ser vigiado."],
      classification: "no_signal",
      invalidatedByRisk: false,
      latestSnapshotAgeMs: Infinity,
      asymmetryPotential: null,
      metrics: emptyMetrics,
    };
  }

  const latestSnapshotAgeMs = Date.now() - latest.timestamp;

  const momentum = computeMomentum(sorted, latest);
  const volumeAcc = computeVolumeAcceleration(sorted, latest);
  const buyImbalance = computeBuyImbalance(latest);
  const liquidity = computeLiquidityQuality(latest);
  const structure = computeMarketStructure(latest, dex?.pairCreatedAt ?? null);
  const catalyst = computeCatalyst(catalysts);
  const asymmetryPotential = computeAsymmetryPotential(latest.marketCap);

  const components: OpportunityComponents = {
    momentum: momentum.score,
    volumeAcceleration: volumeAcc.score,
    buyImbalance: buyImbalance.score,
    liquidityQuality: liquidity.score,
    marketStructure: structure.score,
    catalyst: catalyst.score,
  };

  const availability: Record<keyof OpportunityComponents, boolean> = {
    momentum: momentum.available,
    volumeAcceleration: volumeAcc.available,
    buyImbalance: buyImbalance.available,
    liquidityQuality: liquidity.available,
    marketStructure: structure.available,
    catalyst: catalyst.available,
  };

  const weights = CFG.weights;
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const availableWeight = (Object.keys(weights) as (keyof OpportunityComponents)[]).reduce(
    (a, k) => a + (availability[k] ? weights[k] : 0),
    0
  );
  const confidence = totalWeight > 0 ? Math.round((availableWeight / totalWeight) * 100) / 100 : 0;

  let total: number | null = null;
  if (availableWeight > 0) {
    const weightedSum = (Object.keys(weights) as (keyof OpportunityComponents)[]).reduce((a, k) => {
      const v = components[k];
      return a + (availability[k] && v !== null ? v * weights[k] : 0);
    }, 0);
    total = Math.round(clamp(weightedSum / availableWeight, 0, 100) * 10) / 10;
  }

  const reasons: string[] = [...momentum.reasons];
  if (volumeAcc.reason) reasons.push(volumeAcc.reason);
  if (buyImbalance.reason) reasons.push(buyImbalance.reason);
  if (liquidity.score !== null && liquidity.score >= 70) reasons.push("Liquidez adequada face à capitalização/volume");
  reasons.push(...catalyst.reasons);

  const gates = evaluateOpportunityRiskGates({
    latestSnapshotAgeMs,
    liquidityUsd: latest.liquidityUsd,
    marketCap: latest.marketCap,
    confidence,
    snapshotCount: sorted.length,
    tokenAgeDays: structure.ageDays,
    buySellSampleSize: buyImbalance.sampleSize,
    recentReturnPercent: momentum.change5m,
    longReturnPercent: momentum.change1h,
  });

  let classification: OpportunityClassification = "no_signal";
  if (total !== null) {
    const t = CFG.classificationThresholds;
    if (total >= t.veryStrong) classification = "very_strong_opportunity";
    else if (total >= t.strong) classification = "strong_opportunity";
    else if (total >= t.highMomentum) classification = "high_momentum_watch";
    else if (total >= t.watch) classification = "watch";
    else classification = "no_signal";
  }

  const invalidatedByRisk = !gates.passed && classification !== "no_signal";
  if (invalidatedByRisk) classification = "no_signal";

  // Evidence Gate: score alto por renormalização não chega para uma recomendação forte.
  if (classification !== "no_signal" && !invalidatedByRisk) {
    const evidence = CFG.evidence;
    const hasStrongEvidence =
      (!evidence.requireMomentumForStrong || (momentum.available && (momentum.score ?? 0) >= evidence.minimumMomentumScoreForStrong)) &&
      (!evidence.requireVolumeForStrong || (volumeAcc.available && (volumeAcc.ratio ?? 0) >= evidence.minimumVolumeRatioForStrong)) &&
      sorted.length >= evidence.minimumSnapshotsForStrong;

    if (classification === "strong_opportunity" || classification === "very_strong_opportunity") {
      if (!hasStrongEvidence) {
        classification = total !== null && total >= CFG.classificationThresholds.highMomentum ? "high_momentum_watch" : "watch";
        gates.warnings.push("Evidência insuficiente para sinal forte: momentum, anomalia de volume ou histórico temporal em falta");
      } else if (classification === "very_strong_opportunity") {
        const hasVeryStrongEvidence =
          (volumeAcc.ratio ?? 0) >= evidence.minimumVolumeRatioForVeryStrong &&
          (!evidence.requireBuyImbalanceForVeryStrong ||
            (buyImbalance.available && (buyImbalance.score ?? 0) >= evidence.minimumBuyImbalanceScoreForVeryStrong));
        if (!hasVeryStrongEvidence) {
          classification = "strong_opportunity";
          gates.warnings.push("Very Strong rebaixado: falta confirmação adicional de volume/transações");
        }
      }
    }
  }

  return {
    total,
    components,
    confidence,
    reasons,
    risks: [...gates.criticalRisks, ...gates.warnings],
    classification,
    invalidatedByRisk,
    latestSnapshotAgeMs,
    asymmetryPotential,
    metrics: {
      change5m: momentum.change5m,
      change15m: momentum.change15m,
      change1h: momentum.change1h,
      recentVelocity: momentum.recentVelocity,
      previousVelocity: momentum.previousVelocity,
      accelerationRatio: momentum.accelerationRatio,
      volumeRatio: volumeAcc.ratio,
      baselineVolumeM5: volumeAcc.baselineVolumeM5,
      volumeAnomalyStrength: volumeAcc.anomalyStrength,
      buySellRatio: buyImbalance.rawRatio,
      buySellSampleSize: buyImbalance.sampleSize,
      dexPriceChangeM5: dex?.priceChangeM5 ?? null,
    },
  };
}
