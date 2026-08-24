import {
  LastClassificationState,
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
// sem uma base de dados configurada, e para o build/typecheck não dependerem
// de credenciais. Ver README para configurar o Redis real (Upstash).
// ---------------------------------------------------------------------------

const watchedTokens = new Map<string, WatchedTokenRecord>();
const snapshots = new Map<string, Snapshot[]>();
const signalsByToken = new Map<string, StoredSignal[]>();
const signalsAll: StoredSignal[] = [];
const lastClassification = new Map<string, LastClassificationState>();

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

  async getRecentSignals(tokenKey: string | null, limit: number): Promise<StoredSignal[]> {
    const source = tokenKey ? signalsByToken.get(tokenKey) ?? [] : signalsAll;
    return source.slice(0, limit);
  }

  async getLastClassification(tokenKey: string): Promise<LastClassificationState | null> {
    return lastClassification.get(tokenKey) ?? null;
  }

  async setLastClassification(tokenKey: string, state: LastClassificationState): Promise<void> {
    lastClassification.set(tokenKey, state);
  }
}
