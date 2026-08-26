import { OPPORTUNITY_CONFIG } from "./opportunityConfig";

// ---------------------------------------------------------------------------
// Risk Gates — camada explícita e separada do cálculo do score (Fase 10).
// ---------------------------------------------------------------------------
// A segurança tem sempre prioridade sobre o momentum: um "critical risk" aqui
// força a classificação para "no_signal", mesmo que o score bruto seja alto.
// Os "warnings" não invalidam a classificação, mas são mostrados na UI.
// ---------------------------------------------------------------------------

export interface RiskGateInput {
  latestSnapshotAgeMs: number;
  liquidityUsd: number | null;
  marketCap: number | null;
  confidence: number;
  snapshotCount: number;
  tokenAgeDays: number | null;
  buySellSampleSize: number | null;
  /** Retorno recente (últimos 5min) e retorno mais longo (15-60min), para detetar deterioração após subida extrema. */
  recentReturnPercent: number | null;
  longReturnPercent: number | null;
}

export interface RiskGateResult {
  passed: boolean;
  criticalRisks: string[];
  warnings: string[];
}

export function evaluateOpportunityRiskGates(input: RiskGateInput): RiskGateResult {
  const cfg = OPPORTUNITY_CONFIG;
  const criticalRisks: string[] = [];
  const warnings: string[] = [];

  if (input.latestSnapshotAgeMs > cfg.freshness.maxLiveSnapshotAgeMs) {
    criticalRisks.push("Market data is stale — live signal disabled");
  }

  if (input.liquidityUsd !== null) {
    if (input.liquidityUsd < cfg.liquidity.critical) {
      criticalRisks.push(`Liquidez crítica (abaixo de $${cfg.liquidity.critical.toLocaleString("en-US")})`);
    } else if (input.liquidityUsd < cfg.liquidity.veryLow) {
      warnings.push(`Liquidez muito baixa (abaixo de $${cfg.liquidity.veryLow.toLocaleString("en-US")})`);
    }
  } else {
    warnings.push("Liquidez desconhecida — não foi possível confirmar via DexScreener");
  }

  if (input.confidence < cfg.riskGates.minimumConfidence) {
    criticalRisks.push(
      `Confiança insuficiente (${(input.confidence * 100).toFixed(0)}% — mínimo ${(cfg.riskGates.minimumConfidence * 100).toFixed(0)}%)`
    );
  }

  if (input.snapshotCount < cfg.riskGates.minimumHistoryForFullConfidence) {
    warnings.push(
      `Histórico curto (${input.snapshotCount} snapshot(s)) — o token ainda está a acumular dados`
    );
  }

  if (input.tokenAgeDays !== null && input.tokenAgeDays < cfg.marketStructure.veryNewTokenAgeDays) {
    if (input.liquidityUsd !== null && input.liquidityUsd < cfg.liquidity.low) {
      criticalRisks.push("Token extremamente recente combinado com liquidez baixa");
    } else {
      warnings.push("Token extremamente recente (menos de 24h)");
    }
  }

  if (
    input.recentReturnPercent !== null &&
    input.longReturnPercent !== null &&
    input.longReturnPercent > 50 &&
    input.recentReturnPercent < 0
  ) {
    warnings.push("Subida extrema seguida de deterioração recente — risco elevado de reversão");
  }

  if (input.buySellSampleSize !== null && input.buySellSampleSize < cfg.buyImbalance.minimumSampleSize) {
    warnings.push("Amostra de transações pequena — o rácio compras/vendas pode não ser representativo");
  }

  return { passed: criticalRisks.length === 0, criticalRisks, warnings };
}
