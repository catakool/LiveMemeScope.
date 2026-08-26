import {
  CurrentTokenState,
  LastClassificationState,
  MonitorHealth,
  RadarCandidateState,
  TradingPosition,
  Snapshot,
  StorageAdapter,
  StoredSignal,
  WatchedTokenRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Fallback em memória — usado APENAS quando não há Redis configurado.
// ---------------------------------------------------------------------------
// AVISO: isto não é persistente. Cada invocação serverless da Vercel pode
// arrancar um processo novo, pelo que este estado pode desaparecer a qualquer
// momento e NÃO deve ser usado em produção. Serve para desenvolvimento local
// sem uma base de dados configurada. Ver README para configurar o Redis real.
// ---------------------------------------------------------------------------

const watchedTokens = new Map<string, WatchedTokenRecord>();
const snapshots = new Map<string, Snapshot[]>();
const signalsByToken = new Map<string, StoredSignal[]>();
const signalsAll: StoredSignal[] = [];
const lastClassification = new Map<string, LastClassificationState>();
const currentStates = new Map<string, CurrentTokenState>();
const radarCandidates = new Map<string, RadarCandidateState>();
const tradingPositions = new Map<string, TradingPosition>();
let monitorHealth: MonitorHealth | null = null;

let warned = false;
function warnOnce() {
  if (!warned) {
    warned = true;
    console.warn(
      "[MemeScope] Redis não configurado — a usar armazenamento em memória, NÃO persistente. " +
        "Configure KV_REST_API_URL/KV_REST_API_TOKEN (integração 'Upstash for Redis' na Vercel) para produção."
    );
  }
}

function hasPendingOutcome(s: StoredSignal): boolean {
  return (
    s.priceAt24h === undefined ||
    s.priceAt24h === null ||
    s.priceAt6h === undefined ||
    s.priceAt6h === null ||
    s.priceAt1h === undefined ||
    s.priceAt1h === null ||
    s.priceAt15m === undefined ||
    s.priceAt15m === null ||
    s.priceAt5m === undefined ||
    s.priceAt5m === null
  );
}

export class MemoryStorageAdapter implements StorageAdapter {
  kind = "memory" as const;

  async listWatchedTokens(): Promise<WatchedTokenRecord[]> {
    warnOnce();
    return Array.from(watchedTokens.values());
  }

  async upsertWatchedToken(token: WatchedTokenRecord): Promise<void> {
    warnOnce();
    watchedTokens.set(token.key, token);
  }

  async removeWatchedToken(key: string): Promise<void> {
    watchedTokens.delete(key);
  }

  async appendSnapshot(snapshot: Snapshot, maxHistory: number): Promise<void> {
    warnOnce();
    const list = snapshots.get(snapshot.tokenKey) ?? [];
    list.push(snapshot);
    list.sort((a, b) => a.timestamp - b.timestamp);
    while (list.length > maxHistory) list.shift();
    snapshots.set(snapshot.tokenKey, list);
  }

  async getRecentSnapshots(tokenKey: string, sinceMs: number): Promise<Snapshot[]> {
    const list = snapshots.get(tokenKey) ?? [];
    return list.filter((s) => s.timestamp >= sinceMs);
  }

  async appendSignal(signal: StoredSignal, maxGlobalHistory: number): Promise<void> {
    warnOnce();
    signalsAll.unshift(signal);
    while (signalsAll.length > maxGlobalHistory) signalsAll.pop();
    const list = signalsByToken.get(signal.tokenKey) ?? [];
    list.unshift(signal);
    while (list.length > 200) list.pop();
    signalsByToken.set(signal.tokenKey, list);
  }

  async updateSignal(signal: StoredSignal): Promise<void> {
    const replace = (arr: StoredSignal[]) => {
      const idx = arr.findIndex((s) => s.id === signal.id);
      if (idx >= 0) arr[idx] = signal;
    };
    replace(signalsAll);
    replace(signalsByToken.get(signal.tokenKey) ?? []);
  }

  async getRecentSignals(tokenKey: string | null, limit: number): Promise<StoredSignal[]> {
    const source = tokenKey ? signalsByToken.get(tokenKey) ?? [] : signalsAll;
    return source.slice(0, limit);
  }

  async getSignalsPendingOutcomes(olderThanMs: number, limit: number): Promise<StoredSignal[]> {
    const cutoff = Date.now() - olderThanMs;
    return signalsAll
      .filter((s) => new Date(s.timestamp).getTime() <= cutoff && hasPendingOutcome(s))
      .slice(0, limit);
  }

  async getLastClassification(tokenKey: string): Promise<LastClassificationState | null> {
    return lastClassification.get(tokenKey) ?? null;
  }

  async setLastClassification(tokenKey: string, state: LastClassificationState): Promise<void> {
    lastClassification.set(tokenKey, state);
  }

  async deleteLastClassification(tokenKey: string): Promise<void> {
    lastClassification.delete(tokenKey);
  }

  async setCurrentTokenState(state: CurrentTokenState): Promise<void> {
    currentStates.set(state.tokenKey, state);
  }

  async getCurrentTokenState(tokenKey: string): Promise<CurrentTokenState | null> {
    return currentStates.get(tokenKey) ?? null;
  }

  async listCurrentTokenStates(): Promise<CurrentTokenState[]> {
    return Array.from(currentStates.values());
  }

  async deleteCurrentTokenState(tokenKey: string): Promise<void> {
    currentStates.delete(tokenKey);
  }

  async setRadarCandidate(state: RadarCandidateState): Promise<void> { radarCandidates.set(state.tokenKey, state); }
  async getRadarCandidate(tokenKey: string): Promise<RadarCandidateState | null> { return radarCandidates.get(tokenKey) ?? null; }
  async listRadarCandidates(): Promise<RadarCandidateState[]> { return Array.from(radarCandidates.values()); }

  async upsertTradingPosition(position: TradingPosition): Promise<void> { tradingPositions.set(position.id, position); }
  async getTradingPosition(id: string): Promise<TradingPosition | null> { return tradingPositions.get(id) ?? null; }
  async listTradingPositions(): Promise<TradingPosition[]> { return Array.from(tradingPositions.values()); }

  async setMonitorHealth(health: MonitorHealth): Promise<void> {
    monitorHealth = health;
  }

  async getMonitorHealth(): Promise<MonitorHealth | null> {
    return monitorHealth;
  }
}
