import { DexPairData, MarketData } from "./types";
import { Snapshot } from "./storage";
import { CatalystSignal } from "./catalystProvider";

// ---------------------------------------------------------------------------
// MemeScope Opportunity Engine
// ---------------------------------------------------------------------------
// Módulo SEPARADO de scoring.ts (que mede Opportunity/Risk "estáticos", ponto
// a ponto). Este motor analisa a SÉRIE TEMPORAL de snapshots para detetar
// ACELERAÇÃO — mudança de comportamento normal para extraordinário — e não
// apenas "está a subir".
//
// Princípios (iguais aos de scoring.ts, repetidos aqui por independência):
//  - nunca inventar valores: componente sem dados reais = null + available:false;
//  - confidence é a fração do peso coberta por dados reais, nunca igual ao score;
//  - segurança > momentum: um risco crítico invalida a classificação, mesmo
//    com uma pontuação bruta alta.
// ---------------------------------------------------------------------------

export const OPPORTUNITY_WEIGHTS = {
  momentum: 0.25,
  volumeAcceleration: 0.25,
  buyPressure: 0.2,
  liquidityQuality: 0.15,
  marketStructure: 0.1,
  catalyst: 0.05,
};

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

export interface OpportunityComponents {
  momentum: number | null;
  volumeAcceleration: number | null;
  buyPressure: number | null;
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
  /** Métricas cruas usadas para explicar a decisão na UI (Fase 8). */
  metrics: {
    change5m: number | null;
    change15m: number | null;
    change1h: number | null;
    volumeAccelerationRatio: number | null;
    buySellRatio: number | null;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function mapChangeToScore(change: number | null, capPercent: number): number | null {
  if (change === null || Number.isNaN(change)) return null;
  return clamp(50 + (change / capPercent) * 50, 0, 100);
}

/** Encontra o snapshot mais próximo de `targetAgoMs` atrás, dentro de uma tolerância. */
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

// ---------------------------------------------------------------------------
// A) Momentum — deteta aceleração, não apenas variação
// ---------------------------------------------------------------------------
function computeMomentum(
  snapshots: Snapshot[],
  latest: Snapshot
): { score: number | null; available: boolean; change5m: number | null; change15m: number | null; change1h: number | null; reasons: string[] } {
  const now = latest.timestamp;
  const s1m = findSnapshotNear(snapshots, now, 60_000, 40_000);
  const s5m = findSnapshotNear(snapshots, now, 5 * 60_000, 2 * 60_000);
  const s15m = findSnapshotNear(snapshots, now, 15 * 60_000, 5 * 60_000);
  const s1h = findSnapshotNear(snapshots, now, 60 * 60_000, 15 * 60_000);

  const change1m = s1m ? pctChange(s1m.price, latest.price) : null;
  const change5m = s5m ? pctChange(s5m.price, latest.price) : null;
  const change15m = s15m ? pctChange(s15m.price, latest.price) : null;
  const change1h = s1h ? pctChange(s1h.price, latest.price) : null;

  const scores: { w: number; v: number }[] = [];
  const c1m = mapChangeToScore(change1m, 3);
  const c5m = mapChangeToScore(change5m, 8);
  const c15m = mapChangeToScore(change15m, 20);
  const c1h = mapChangeToScore(change1h, 40);
  if (c1m !== null) scores.push({ w: 0.15, v: c1m });
  if (c5m !== null) scores.push({ w: 0.35, v: c5m });
  if (c15m !== null) scores.push({ w: 0.3, v: c15m });
  if (c1h !== null) scores.push({ w: 0.2, v: c1h });

  if (scores.length === 0) {
    return { score: null, available: false, change5m, change15m, change1h, reasons: [] };
  }

  const totalW = scores.reduce((a, s) => a + s.w, 0);
  let base = scores.reduce((a, s) => a + s.v * s.w, 0) / totalW;

  const reasons: string[] = [];
  // Deteção de aceleração: janelas curtas com retorno mais forte que janelas longas, todas positivas.
  if (change5m !== null && change15m !== null && change1h !== null) {
    const accelerating = change5m > change15m * 0.4 && change15m > change1h * 0.4 && change5m > 0 && change15m > 0;
    if (accelerating) {
      base = clamp(base + 12, 0, 100);
      reasons.push("Aceleração de preço: janelas curtas a subir mais depressa que as longas");
    }
    const decelerating = change5m < 0 && change1h > 0;
    if (decelerating) {
      base = clamp(base - 10, 0, 100);
      reasons.push("Desaceleração: o movimento recente já não acompanha a subida mais longa");
    }
  }

  return { score: Math.round(base * 10) / 10, available: true, change5m, change15m, change1h, reasons };
}

// ---------------------------------------------------------------------------
// B) Volume acceleration
// ---------------------------------------------------------------------------
function equivalentHourlyRate(s: Snapshot): number | null {
  if (s.volumeM5 !== null) return s.volumeM5 * 12;
  if (s.volumeH1 !== null) return s.volumeH1;
  if (s.volumeH6 !== null) return s.volumeH6 / 6;
  if (s.volumeH24 !== null) return s.volumeH24 / 24;
  return null;
}

function computeVolumeAcceleration(
  snapshots: Snapshot[],
  latest: Snapshot
): { score: number | null; available: boolean; ratio: number | null; reason: string | null } {
  const rateNow = equivalentHourlyRate(latest);
  if (rateNow === null) return { score: null, available: false, ratio: null, reason: null };

  const historical = snapshots.filter((s) => s.timestamp < latest.timestamp - 4 * 60_000);
  if (historical.length < 3) {
    return { score: null, available: false, ratio: null, reason: null };
  }
  const rates = historical.map(equivalentHourlyRate).filter((r): r is number => r !== null);
  if (rates.length < 3) return { score: null, available: false, ratio: null, reason: null };

  const baseline = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (baseline <= 0) return { score: null, available: false, ratio: null, reason: null };

  const ratio = rateNow / baseline;
  const score = ratio >= 1 ? clamp(50 + (50 * Math.log2(ratio)) / Math.log2(10), 0, 100) : clamp(50 * ratio, 0, 50);
  const reason = ratio >= 3 ? `Volume ${ratio.toFixed(1)}x acima do habitual para este token` : null;
  return { score: Math.round(score * 10) / 10, available: true, ratio: Math.round(ratio * 100) / 100, reason };
}

// ---------------------------------------------------------------------------
// C) Buy/sell pressure
// ---------------------------------------------------------------------------
function computeBuyPressure(
  latest: Snapshot
): { score: number | null; available: boolean; ratio: number | null; reason: string | null } {
  const windows: { buys: number | null; sells: number | null }[] = [
    { buys: latest.buysM5, sells: latest.sellsM5 },
    { buys: latest.buysH1, sells: latest.sellsH1 },
    { buys: latest.buysH6, sells: latest.sellsH6 },
    { buys: latest.buysH24, sells: latest.sellsH24 },
  ];
  for (const w of windows) {
    if (w.buys !== null && w.sells !== null) {
      const total = w.buys + w.sells;
      if (total >= 3) {
        const ratio = w.buys / total;
        const score = clamp(ratio * 100, 0, 100);
        const reason = ratio > 0.65 ? "Predomínio claro de compras sobre vendas" : null;
        return { score: Math.round(score * 10) / 10, available: true, ratio: Math.round(ratio * 100) / 100, reason };
      }
    }
  }
  return { score: null, available: false, ratio: null, reason: null };
}

// ---------------------------------------------------------------------------
// D) Liquidity quality
// ---------------------------------------------------------------------------
function computeLiquidityQuality(
  latest: Snapshot
): { score: number | null; available: boolean; risk: string | null } {
  if (latest.liquidityUsd === null) return { score: null, available: false, risk: null };

  if (latest.marketCap && latest.marketCap > 0) {
    const ratio = latest.liquidityUsd / latest.marketCap;
    const score = clamp((ratio / 0.15) * 100, 0, 100);
    const risk = latest.liquidityUsd < 15_000 ? "Liquidez extremamente baixa (abaixo de $15k)" : null;
    return { score: Math.round(score * 10) / 10, available: true, risk };
  }

  // sem market cap: usar liquidez absoluta como proxy mais fraco
  const score = clamp((latest.liquidityUsd / 100_000) * 100, 0, 100);
  const risk = latest.liquidityUsd < 15_000 ? "Liquidez extremamente baixa (abaixo de $15k)" : null;
  return { score: Math.round(score * 10) / 10, available: true, risk };
}

// ---------------------------------------------------------------------------
// E) Market structure / token age
// ---------------------------------------------------------------------------
function computeMarketStructure(
  latest: Snapshot,
  pairCreatedAt: string | null
): { score: number | null; available: boolean; risk: string | null } {
  const parts: number[] = [];
  let risk: string | null = null;

  if (pairCreatedAt) {
    const ageDays = (Date.now() - new Date(pairCreatedAt).getTime()) / 86_400_000;
    let ageScore: number;
    if (ageDays < 1) {
      ageScore = 35;
      risk = "Token extremamente recente (menos de 24h)";
    } else if (ageDays < 7) ageScore = 70;
    else if (ageDays < 90) ageScore = 100;
    else ageScore = 55;
    parts.push(ageScore);
  }

  if (latest.marketCap !== null && latest.marketCap > 0) {
    let mcapScore: number;
    if (latest.marketCap < 1_000_000) mcapScore = 100;
    else if (latest.marketCap < 10_000_000) mcapScore = 80;
    else if (latest.marketCap < 100_000_000) mcapScore = 50;
    else mcapScore = 20;
    parts.push(mcapScore);
  }

  if (parts.length === 0) return { score: null, available: false, risk: null };
  const score = parts.reduce((a, b) => a + b, 0) / parts.length;
  return { score: Math.round(score * 10) / 10, available: true, risk };
}

// ---------------------------------------------------------------------------
// F) Catalyst — sempre indisponível nesta versão (ver catalystProvider.ts)
// ---------------------------------------------------------------------------
function computeCatalyst(signals: CatalystSignal[]): { score: number | null; available: boolean; reasons: string[] } {
  if (signals.length === 0) return { score: null, available: false, reasons: [] };
  const score = clamp(
    signals.reduce((a, s) => a + s.weight, 0) / signals.length,
    0,
    100
  );
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

  if (!latest) {
    return {
      total: null,
      components: {
        momentum: null,
        volumeAcceleration: null,
        buyPressure: null,
        liquidityQuality: null,
        marketStructure: null,
        catalyst: null,
      },
      confidence: 0,
      reasons: [],
      risks: ["Ainda sem histórico suficiente — este token acabou de começar a ser vigiado."],
      classification: "no_signal",
      invalidatedByRisk: false,
      metrics: { change5m: null, change15m: null, change1h: null, volumeAccelerationRatio: null, buySellRatio: null },
    };
  }

  const momentum = computeMomentum(sorted, latest);
  const volumeAcc = computeVolumeAcceleration(sorted, latest);
  const buyPressure = computeBuyPressure(latest);
  const liquidity = computeLiquidityQuality(latest);
  const structure = computeMarketStructure(latest, dex?.pairCreatedAt ?? null);
  const catalyst = computeCatalyst(catalysts);

  const components: OpportunityComponents = {
    momentum: momentum.score,
    volumeAcceleration: volumeAcc.score,
    buyPressure: buyPressure.score,
    liquidityQuality: liquidity.score,
    marketStructure: structure.score,
    catalyst: catalyst.score,
  };

  const availability: Record<keyof OpportunityComponents, boolean> = {
    momentum: momentum.available,
    volumeAcceleration: volumeAcc.available,
    buyPressure: buyPressure.available,
    liquidityQuality: liquidity.available,
    marketStructure: structure.available,
    catalyst: catalyst.available,
  };

  const totalWeight = Object.values(OPPORTUNITY_WEIGHTS).reduce((a, b) => a + b, 0);
  const availableWeight = (Object.keys(OPPORTUNITY_WEIGHTS) as (keyof OpportunityComponents)[]).reduce(
    (a, k) => a + (availability[k] ? OPPORTUNITY_WEIGHTS[k] : 0),
    0
  );
  const confidence = totalWeight > 0 ? Math.round((availableWeight / totalWeight) * 100) / 100 : 0;

  let total: number | null = null;
  if (availableWeight > 0) {
    const weightedSum = (Object.keys(OPPORTUNITY_WEIGHTS) as (keyof OpportunityComponents)[]).reduce((a, k) => {
      const v = components[k];
      return a + (availability[k] && v !== null ? v * OPPORTUNITY_WEIGHTS[k] : 0);
    }, 0);
    total = Math.round(clamp(weightedSum / availableWeight, 0, 100) * 10) / 10;
  }

  const reasons: string[] = [...momentum.reasons];
  if (volumeAcc.reason) reasons.push(volumeAcc.reason);
  if (buyPressure.reason) reasons.push(buyPressure.reason);
  if (liquidity.score !== null && liquidity.score >= 70) reasons.push("Liquidez adequada face à capitalização/volume");
  reasons.push(...catalyst.reasons);

  const risks: string[] = [];
  if (liquidity.risk) risks.push(liquidity.risk);
  if (structure.risk) risks.push(structure.risk);
  if (confidence < 0.4) risks.push("Dados insuficientes para uma leitura fiável (confiança baixa)");
  if (momentum.change1h !== null && momentum.change1h > 15 && (liquidity.score ?? 100) < 40) {
    risks.push("Subida acentuada com liquidez fraca — risco elevado de reversão");
  }

  const criticalRisk =
    (dex?.liquidityUsd !== null && dex?.liquidityUsd !== undefined && dex.liquidityUsd < 15_000) ||
    confidence < 0.35;

  let classification: OpportunityClassification = "no_signal";
  if (total !== null) {
    if (total >= 90) classification = "very_strong_opportunity";
    else if (total >= 80) classification = "strong_opportunity";
    else if (total >= 70) classification = "high_momentum_watch";
    else if (total >= 60) classification = "watch";
    else classification = "no_signal";
  }

  const invalidatedByRisk = criticalRisk && classification !== "no_signal";
  if (invalidatedByRisk) {
    classification = "no_signal";
    if (!risks.some((r) => r.includes("Liquidez extremamente baixa"))) {
      risks.push("Sinal invalidado por risco crítico apesar da pontuação bruta elevada");
    }
  }

  return {
    total,
    components,
    confidence,
    reasons,
    risks,
    classification,
    invalidatedByRisk,
    metrics: {
      change5m: momentum.change5m,
      change15m: momentum.change15m,
      change1h: momentum.change1h,
      volumeAccelerationRatio: volumeAcc.ratio,
      buySellRatio: buyPressure.ratio,
    },
  };
}
