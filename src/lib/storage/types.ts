import { Chain } from "../types";

/**
 * Identidade única de um token vigiado: contrato + chain quando existe,
 * ou o id da CoinGecko para moedas nativas sem contrato (ex.: DOGE).
 * NUNCA o símbolo sozinho — dois tokens podem partilhar símbolo.
 */
export function watchedTokenKey(params: { coingeckoId?: string | null; chain: Chain; address?: string | null }): string {
  if (params.address) return `${params.chain}:${params.address.toLowerCase()}`;
  if (params.coingeckoId) return `cg:${params.coingeckoId}`;
  throw new Error("watchedTokenKey requer address+chain ou coingeckoId");
}

export type WatchedTokenSource = "discovery" | "manual";

export interface WatchedTokenRecord {
  key: string; // ver watchedTokenKey()
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
}

/** Última classificação conhecida de um token, usada para deduplicar/cooldown de alertas e sinais. */
export interface LastClassificationState {
  classification: SignalClassification;
  score: number | null;
  timestamp: string;
}

export interface StorageAdapter {
  kind: "redis" | "memory";

  listWatchedTokens(): Promise<WatchedTokenRecord[]>;
  upsertWatchedToken(token: WatchedTokenRecord): Promise<void>;
  removeWatchedToken(key: string): Promise<void>;

  appendSnapshot(snapshot: Snapshot, maxHistory: number): Promise<void>;
  getRecentSnapshots(tokenKey: string, sinceMs: number): Promise<Snapshot[]>;

  appendSignal(signal: StoredSignal, maxGlobalHistory: number): Promise<void>;
  getRecentSignals(tokenKey: string | null, limit: number): Promise<StoredSignal[]>;

  getLastClassification(tokenKey: string): Promise<LastClassificationState | null>;
  setLastClassification(tokenKey: string, state: LastClassificationState): Promise<void>;
}
