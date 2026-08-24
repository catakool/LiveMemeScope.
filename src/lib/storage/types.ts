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

  setMonitorHealth(health: MonitorHealth): Promise<void>;
  getMonitorHealth(): Promise<MonitorHealth | null>;
}
