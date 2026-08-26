import { Chain } from "../types";

export { watchedTokenKey, parseTokenKey } from "../tokenKey";

export type WatchedTokenSource = "discovery" | "manual";

export interface WatchedTokenRecord {
  key: string; // ver watchedTokenKey() em lib/tokenKey.ts
  source: WatchedTokenSource;
  coingeckoId: string | null;
  symbol: string;
  name: string;
  chain: Chain;
  contractAddress: string | null;
  addedAt: string; // ISO
  lastSeenAt: string; // ISO, atualizado sempre que o job de monitorização o processa
  /** Prioridade de atualização (maior = processado primeiro no batching do cron). */
  priority: number;
  /** ISO — última vez que este token foi efetivamente processado (snapshot gravado). Usado para round-robin/fairness. */
  lastProcessedAt?: string | null;
}

/** Um snapshot curto, guardado periodicamente pelo job de monitorização. */
export interface Snapshot {
  tokenKey: string;
  chain: Chain;
  address: string | null;
  coingeckoId: string | null;
  timestamp: number; // epoch ms
  price: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  volumeM5: number | null;
  volumeH1: number | null;
  volumeH6: number | null;
  volumeH24: number | null;
  buysM5: number | null;
  sellsM5: number | null;
  buysH1: number | null;
  sellsH1: number | null;
  buysH6: number | null;
  sellsH6: number | null;
  buysH24: number | null;
  sellsH24: number | null;
}

export type SignalClassification =
  | "very_strong_opportunity"
  | "strong_opportunity"
  | "high_momentum_watch"
  | "watch"
  | "no_signal";

/**
 * Estado de um sinal guardado, incluindo os "outcomes" preenchidos mais tarde
 * pelo próprio job de monitorização (Fase 15 — infraestrutura de backtesting).
 * Nenhum destes campos é usado para calcular o score original — só servem
 * para avaliação posterior de quão bem (ou mal) o sinal se saiu.
 */
export interface StoredSignal {
  id: string;
  tokenKey: string;
  coingeckoId: string | null;
  chain: Chain;
  address: string | null;
  symbol: string;
  timestamp: string; // ISO
  price: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  volumeH24: number | null;
  opportunityScore: number | null;
  components: Record<string, number | null>;
  confidence: number;
  classification: SignalClassification;
  reasons: string[];
  risks: string[];
  invalidatedByRisk: boolean;

  // --- Outcomes para backtesting, preenchidos posteriormente (podem ficar null indefinidamente se faltar dado real) ---
  priceAt5m?: number | null;
  priceAt15m?: number | null;
  priceAt1h?: number | null;
  priceAt6h?: number | null;
  priceAt24h?: number | null;
  return5m?: number | null;
  return15m?: number | null;
  return1h?: number | null;
  return6h?: number | null;
  return24h?: number | null;
  /** Maior valorização vista entre o sinal e o preenchimento do outcome mais recente. */
  maxFavorableExcursion?: number | null;
  /** Maior queda vista entre o sinal e o preenchimento do outcome mais recente. */
  maxAdverseExcursion?: number | null;
}

/** Última classificação conhecida de um token, usada para deduplicar/cooldown de alertas e sinais. */
export interface LastClassificationState {
  classification: SignalClassification;
  score: number | null;
  timestamp: string;
  /** Último StoredSignal realmente emitido; preservado através de no_signal para cooldown server-side. */
  lastSignalAt?: string | null;
}

/**
 * Estado atual e "pronto a mostrar" de um token, persistido pelo monitor a
 * cada ciclo (Fase 11). O dashboard lê isto em vez de recalcular tudo a cada
 * visita — abrir vários browsers não deve multiplicar os pedidos às APIs
 * externas.
 */
export interface CurrentTokenState {
  tokenKey: string;
  updatedAt: string; // ISO — quando este estado foi calculado pelo monitor
  latestSnapshotAgeMs: number;
  marketRaw: unknown; // MarketData | null, guardado como unknown para não criar dependência circular de tipos
  dexRaw: unknown; // DexPairData | null
  opportunityRaw: unknown; // OpportunityResult | null
}



export type SecurityRiskLevel = "low" | "medium" | "high" | "critical" | "unknown";

export interface SecurityProviderState {
  status: "live" | "not_configured" | "unavailable";
  detail: string | null;
}

/** Resumo persistível: nunca contém API keys nem payloads crus dos providers. */
export interface SecurityAssessment {
  checkedAt: string;
  score: number | null;
  risk: SecurityRiskLevel;
  critical: boolean;
  completeness: number;
  blockers: string[];
  warnings: string[];
  positives: string[];
  providers: { goplus: SecurityProviderState; solscan: SecurityProviderState };
  holderCount: number | null;
  top1HolderPercent: number | null;
  top10HolderPercent: number | null;
  creatorPercent: number | null;
  lpLockedPercent: number | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  mintable: boolean | null;
  freezable: boolean | null;
  closable: boolean | null;
  balanceMutable: boolean | null;
  metadataMutable: boolean | null;
}

export interface RadarCandidateState {
  tokenKey: string;
  chain: Chain;
  address: string;
  name: string;
  symbol: string;
  pairAddress: string | null;
  dexId: string | null;
  pairCreatedAt: string;
  firstDetectedAt: string;
  firstDetectedPrice: number | null;
  firstDetectedScore?: number | null;
  lastSeenAt: string;
  lastQualifiedAt?: string | null;
  price: number | null;
  peakPriceSinceDetected?: number | null;
  peakReturnSinceDetected?: number | null;
  liquidityUsd: number | null;
  marketCapOrFdv: number | null;
  marketCapIsFdv: boolean;
  volumeM5: number | null;
  volumeH1: number | null;
  volumeH24: number | null;
  buysM5: number | null;
  sellsM5: number | null;
  buysH1: number | null;
  sellsH1: number | null;
  priceChangeM5: number | null;
  priceChangeH1: number | null;

  /**
   * Qualidade da atividade baseada APENAS em dados agregados da DexScreener.
   * Não representa uma contagem exata de microtransações individuais.
   */
  transactionQualityScore?: number | null;
  averageTradeUsdM5?: number | null;
  activityInflationRisk?: "low" | "medium" | "high" | "critical" | "unknown";
  activityPenalty?: number;
  rawEarlyMomentumScore?: number | null;
  transactionQualityDetail?: string | null;

  /** Backtest de continuação desde a primeira deteção do Radar. */
  continuationPrice1m?: number | null;
  continuationPrice3m?: number | null;
  continuationPrice5m?: number | null;
  continuationPrice10m?: number | null;
  continuationPrice15m?: number | null;
  continuationPrice30m?: number | null;
  continuationPrice60m?: number | null;
  continuationReturn1m?: number | null;
  continuationReturn3m?: number | null;
  continuationReturn5m?: number | null;
  continuationReturn10m?: number | null;
  continuationReturn15m?: number | null;
  continuationReturn30m?: number | null;
  continuationReturn60m?: number | null;
  continuationMfe60m?: number | null;
  continuationMae60m?: number | null;

  /** Security Engine (Solana): GoPlus + Solscan, persistido para respeitar rate limits. */
  securityAssessment?: SecurityAssessment | null;
  nextSecurityCheckAt?: string | null;

  /** Catalyst é calculado em runtime e não precisa ser persistido integralmente. */
  catalystAssessment?: unknown | null;

  /** Como o token apareceu no feed da DexScreener. */
  source: "latest_profile" | "boosted" | "both";
  boostAmount: number | null;
  earlyMomentumScore: number;
  /** Última classificação que passou os gates do Radar. */
  classification: "explosive" | "breakout" | "emerging" | "mature";
  /** true apenas quando passa os gates na atualização atual. */
  isLive?: boolean;
  currentStatus?: "live" | "lost_momentum" | "stale";
  currentStatusReason?: string | null;
  reasons: string[];
  risks: string[];

  /** CoinGecko tem prioridade como source visível quando o contrato é confirmado lá. */
  coingeckoId: string | null;
  coingeckoFirstSeenAt: string | null;
  coingeckoPreviouslyNotListed: boolean;
  coingeckoTransitionObservedAt: string | null;
  priceAtCoinGeckoTransition: number | null;
  nextCoinGeckoCheckAt: string | null;

  /** Outcomes observados pela MemeScope após uma transição DEX-only -> CoinGecko. */
  coingeckoReturn15m: number | null;
  coingeckoReturn1h: number | null;
  coingeckoReturn6h: number | null;
  coingeckoReturn24h: number | null;
}


export type TradingPositionMode = "paper" | "manual";
export type TradingPositionStatus = "open" | "closed";
export type ExitSignal = "hold" | "take_profit" | "stop_loss" | "momentum_expired" | "security_exit" | "time_exit" | "stale";
export type SetupType = "A_CONTINUATION" | "B_MOMENTUM" | "C_SPECULATIVE";

export interface TradingSetupSnapshot {
  setupType: SetupType;
  classification: "explosive" | "breakout" | "emerging" | "mature";
  earlyMomentumScore: number;
  continuationScore: number;
  transactionQualityScore: number | null;
  securityScore: number | null;
  securityRisk: SecurityRiskLevel;
  liquidityUsd: number | null;
  marketCapOrFdv: number | null;
  ageMinutes: number;
  buyRatioM5: number | null;
  priceChangeM5: number | null;
  volumeM5: number | null;
  visibleSource: "dexscreener" | "coingecko";
}

export interface TradingPosition {
  id: string;
  mode: TradingPositionMode;
  status: TradingPositionStatus;
  tokenKey: string;
  chain: Chain;
  address: string;
  symbol: string;
  name: string;
  openedAt: string;
  closedAt: string | null;
  entryPrice: number;
  currentPrice: number | null;
  exitPrice: number | null;
  notionalUsd: number;
  quantityVirtual: number;
  realizedReturnPct: number | null;
  unrealizedReturnPct: number | null;
  peakReturnPct: number | null;
  maxDrawdownPct: number | null;
  exitSignal: ExitSignal;
  exitReason: string | null;
  lastUpdatedAt: string;
  setup: TradingSetupSnapshot;
}

export interface SetupPerformanceStats {
  setupType: SetupType;
  sampleSize: number;
  winRatePct: number | null;
  medianReturnPct: number | null;
  averageReturnPct: number | null;
  profitFactor: number | null;
  averageHoldMinutes: number | null;
}

export interface TradingLabSummary {
  generatedAt: string;
  paperOpen: TradingPosition[];
  paperClosed: TradingPosition[];
  manualOpen: TradingPosition[];
  manualClosed: TradingPosition[];
  statsBySetup: SetupPerformanceStats[];
  paperTotalRealizedUsd: number;
  paperWinRatePct: number | null;
  paperTradesClosed: number;
  defaultPaperNotionalUsd: number;
}

/** Diagnóstico do job de monitorização, para o endpoint de health (Fase 17). */
export interface MonitorHealth {
  lastRunAt: string; // ISO
  durationMs: number;
  tokensConsidered: number;
  tokensProcessed: number;
  tokensSkipped: number;
  snapshotsSaved: number;
  signalsGenerated: number;
  apiFailures: number;
  storageKind: "redis" | "memory";
}

export interface StorageAdapter {
  kind: "redis" | "memory";

  listWatchedTokens(): Promise<WatchedTokenRecord[]>;
  upsertWatchedToken(token: WatchedTokenRecord): Promise<void>;
  removeWatchedToken(key: string): Promise<void>;

  appendSnapshot(snapshot: Snapshot, maxHistory: number, ttlSeconds?: number): Promise<void>;
  getRecentSnapshots(tokenKey: string, sinceMs: number): Promise<Snapshot[]>;

  appendSignal(signal: StoredSignal, maxGlobalHistory: number): Promise<void>;
  updateSignal(signal: StoredSignal): Promise<void>;
  getRecentSignals(tokenKey: string | null, limit: number): Promise<StoredSignal[]>;
  /** Sinais com pelo menos um outcome ainda por preencher, mais antigos que `olderThanMs`. */
  getSignalsPendingOutcomes(olderThanMs: number, limit: number): Promise<StoredSignal[]>;

  getLastClassification(tokenKey: string): Promise<LastClassificationState | null>;
  setLastClassification(tokenKey: string, state: LastClassificationState, ttlSeconds?: number): Promise<void>;
  deleteLastClassification(tokenKey: string): Promise<void>;

  setCurrentTokenState(state: CurrentTokenState, ttlSeconds?: number): Promise<void>;
  getCurrentTokenState(tokenKey: string): Promise<CurrentTokenState | null>;
  listCurrentTokenStates(): Promise<CurrentTokenState[]>;
  deleteCurrentTokenState(tokenKey: string): Promise<void>;

  setRadarCandidate(state: RadarCandidateState, ttlSeconds?: number): Promise<void>;
  getRadarCandidate(tokenKey: string): Promise<RadarCandidateState | null>;
  listRadarCandidates(): Promise<RadarCandidateState[]>;

  upsertTradingPosition(position: TradingPosition): Promise<void>;
  getTradingPosition(id: string): Promise<TradingPosition | null>;
  listTradingPositions(): Promise<TradingPosition[]>;

  setMonitorHealth(health: MonitorHealth): Promise<void>;
  getMonitorHealth(): Promise<MonitorHealth | null>;
}
