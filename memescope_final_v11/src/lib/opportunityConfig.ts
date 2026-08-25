// ---------------------------------------------------------------------------
// OPPORTUNITY_CONFIG — configuração central do Opportunity Engine.
// ---------------------------------------------------------------------------
// Todos os pesos, limiares e janelas usados por lib/opportunity.ts e
// lib/riskGates.ts vivem aqui, para poderem ser calibrados depois de haver
// dados de backtesting suficientes (ver secção "Backtesting" do README).
// Nenhum destes valores é definitivo — são pontos de partida razoáveis,
// documentados com a justificação de cada escolha.
// ---------------------------------------------------------------------------

export const OPPORTUNITY_CONFIG = {
  /** Pesos dos componentes do score (frações de 1.0). */
  weights: {
    momentum: 0.25,
    volumeAcceleration: 0.25,
    buyImbalance: 0.2,
    liquidityQuality: 0.15,
    marketStructure: 0.1,
    catalyst: 0.05,
  },

  /** Classificação final (score bruto, antes dos risk gates). */
  classificationThresholds: {
    veryStrong: 90,
    strong: 80,
    highMomentum: 70,
    watch: 60,
  },

  /** Frescura dos dados (Fase 3 do pedido de hardening). */
  freshness: {
    /** Acima disto, uma oportunidade nunca pode aparecer como "live", mesmo com score alto. */
    maxLiveSnapshotAgeMs: 6 * 60_000,
  },

  /** Cadência real do job de monitorização (usada para decidir que janelas são fiáveis). */
  monitor: {
    /** Se a cadência for >= a isto, uma janela de "1 minuto" não é fiável e fica sempre unavailable. */
    minimumReliableIntervalMs: 2 * 60_000,
    maxTokensPerRun: 40,
    snapshotHistoryLimit: 200,
    snapshotLookbackMs: 90 * 60_000,
    signalGlobalHistoryLimit: 500,
  },

  /** Momentum / aceleração de preço — segmentos NÃO sobrepostos (Fase 4). */
  momentum: {
    /** Tolerância ao localizar o snapshot mais próximo de cada fronteira temporal. */
    snapshotToleranceMs: 90_000,
    /** Fronteiras dos 3 segmentos: [0,5m], [5m,15m], [15m,60m]. */
    segmentBoundariesMs: { recent: 5 * 60_000, mid: 15 * 60_000, long: 60 * 60_000 },
    /** "Cap" percentual usado para mapear cada segmento para um score 0-100. */
    capPercent: { recent: 10, mid: 15, long: 30 },
  },

  /** Volume acceleration — baseline robusta (Fase 6). */
  volume: {
    /** Janela do baseline: entre 90min e 20min atrás (exclui os últimos ~20min do próprio spike). */
    baselineWindowStartMs: 90 * 60_000,
    baselineWindowEndMs: 20 * 60_000,
    /** Evita tratar snapshots m5 sobrepostos a cada 2min como observações independentes. */
    baselineSampleSpacingMs: 5 * 60_000,
    minimumBaselineSamples: 5,
    /** Rácio (volume atual / baseline) que corresponde a um score de 100. */
    ratioForMaxScore: 10,
  },

  /** Transaction Buy Imbalance — antigo "buy pressure" (Fase 7). */
  buyImbalance: {
    /** Abaixo disto, o componente fica indisponível (amostra demasiado pequena para significar algo). */
    minimumSampleSize: 10,
    /** Entre minimumSampleSize e este valor, aplica-se shrinkage forte para 50 (neutro). */
    moderateConfidenceSampleSize: 30,
    /** Acima disto, confiança alta, shrinkage mínimo. */
    highConfidenceSampleSize: 100,
  },

  /** Liquidez — limiares graduais (Fase 9), em USD. */
  liquidity: {
    critical: 5_000,
    veryLow: 15_000,
    low: 50_000,
    healthy: 150_000,
  },

  /** Market structure / idade do token (Fase 5 e 8) — já NÃO recompensa microcap por si só. */
  marketStructure: {
    veryNewTokenAgeDays: 1,
    establishedTokenAgeDays: 90,
  },

  /** Risk gates (Fase 10). */
  riskGates: {
    minimumConfidence: 0.35,
    minimumHistoryForFullConfidence: 5, // nº de snapshots
  },

  /** Evidência mínima para classificações fortes: score alto sem dados-chave não basta. */
  evidence: {
    requireMomentumForStrong: true,
    requireVolumeForStrong: true,
    requireBuyImbalanceForVeryStrong: true,
    minimumSnapshotsForStrong: 8,
    minimumMomentumScoreForStrong: 60,
    minimumVolumeRatioForStrong: 1.5,
    minimumVolumeRatioForVeryStrong: 2.5,
    minimumBuyImbalanceScoreForVeryStrong: 58,
  },

  /** Alertas client-side (Fase 13). */
  alerts: {
    /** Tempo mínimo entre dois disparos do mesmo sinal para o mesmo token. */
    cooldownMs: 30 * 60_000,
    /** Também aplicado server-side ao StoredSignal para não contaminar o backtesting. */
    serverSignalCooldownMs: 30 * 60_000,
  },

  /** Tolerância máxima ao escolher o snapshot de cada horizonte de backtesting. */
  outcomes: {
    toleranceMs: {
      m5: 3 * 60_000,
      m15: 4 * 60_000,
      h1: 10 * 60_000,
      h6: 15 * 60_000,
      h24: 30 * 60_000,
    },
    candidatesPerHorizon: 12,
    pendingScanLimit: 250,
  },

  /** Retenção de dados no Redis (Fase 14), em segundos (TTL do Upstash é em segundos). */
  retention: {
    currentStateTtlSeconds: 60 * 60, // 1h — se o monitor parar, o estado "ao vivo" expira sozinho
    lastClassificationTtlSeconds: 24 * 60 * 60, // 1 dia
    snapshotTtlSeconds: 30 * 60 * 60, // 1 dia (o histórico rolante já limita por contagem também)
    // Sinais (StoredSignal) NÃO têm TTL de propósito — são o registo para backtesting.
  },
} as const;
