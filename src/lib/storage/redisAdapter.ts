import { Redis } from "@upstash/redis";
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
// Adaptador de armazenamento persistente (Redis via Upstash).
// ---------------------------------------------------------------------------
// Variáveis de ambiente necessárias em produção (ver README):
//   KV_REST_API_URL / KV_REST_API_TOKEN
//   (ou UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)
// ---------------------------------------------------------------------------

const WATCHED_TOKENS_KEY = "memescope:watched-tokens";
const SIGNALS_ALL_KEY = "memescope:signals:all";
const SIGNALS_PREFIX = "memescope:signals:token:";
const SNAPSHOTS_PREFIX = "memescope:snapshots:";
const LAST_CLASS_PREFIX = "memescope:last-classification:";
const CURRENT_STATE_PREFIX = "memescope:current-state:";
const CURRENT_STATE_INDEX = "memescope:current-state:index"; // set com todas as tokenKeys que têm estado guardado
const MONITOR_HEALTH_KEY = "memescope:monitor-health";
const RADAR_PREFIX = "memescope:radar:candidate:";
const RADAR_INDEX = "memescope:radar:index";
const TRADING_POSITION_PREFIX = "memescope:trading:position:";
const TRADING_POSITION_INDEX = "memescope:trading:positions:index";

function getUrl(): string | undefined {
  return process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
}
function getToken(): string | undefined {
  return process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
}

export function isRedisConfigured(): boolean {
  return Boolean(getUrl() && getToken());
}

let client: Redis | null = null;
function getClient(): Redis {
  if (!client) {
    const url = getUrl();
    const token = getToken();
    if (!url || !token) {
      throw new Error(
        "Redis não configurado: defina KV_REST_API_URL e KV_REST_API_TOKEN (ou UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)."
      );
    }
    client = new Redis({ url, token });
  }
  return client;
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

export class RedisStorageAdapter implements StorageAdapter {
  kind = "redis" as const;

  async listWatchedTokens(): Promise<WatchedTokenRecord[]> {
    const redis = getClient();
    const raw = await redis.hgetall<Record<string, WatchedTokenRecord>>(WATCHED_TOKENS_KEY);
    if (!raw) return [];
    return Object.values(raw);
  }

  async upsertWatchedToken(token: WatchedTokenRecord): Promise<void> {
    const redis = getClient();
    await redis.hset(WATCHED_TOKENS_KEY, { [token.key]: token });
  }

  async removeWatchedToken(key: string): Promise<void> {
    const redis = getClient();
    await redis.hdel(WATCHED_TOKENS_KEY, key);
  }

  async appendSnapshot(snapshot: Snapshot, maxHistory: number, ttlSeconds?: number): Promise<void> {
    const redis = getClient();
    const key = `${SNAPSHOTS_PREFIX}${snapshot.tokenKey}`;
    await redis.zadd(key, { score: snapshot.timestamp, member: JSON.stringify(snapshot) });
    const count = await redis.zcard(key);
    if (count > maxHistory) {
      await redis.zremrangebyrank(key, 0, count - maxHistory - 1);
    }
    if (ttlSeconds) await redis.expire(key, ttlSeconds);
  }

  async getRecentSnapshots(tokenKey: string, sinceMs: number): Promise<Snapshot[]> {
    const redis = getClient();
    const key = `${SNAPSHOTS_PREFIX}${tokenKey}`;
    const raw = await redis.zrange<string[]>(key, sinceMs, Date.now(), { byScore: true });
    return raw.map((s) => (typeof s === "string" ? (JSON.parse(s) as Snapshot) : (s as unknown as Snapshot)));
  }

  async appendSignal(signal: StoredSignal, maxGlobalHistory: number): Promise<void> {
    const redis = getClient();
    const ts = new Date(signal.timestamp).getTime();
    await redis.zadd(SIGNALS_ALL_KEY, { score: ts, member: JSON.stringify(signal) });
    const count = await redis.zcard(SIGNALS_ALL_KEY);
    if (count > maxGlobalHistory) {
      await redis.zremrangebyrank(SIGNALS_ALL_KEY, 0, count - maxGlobalHistory - 1);
    }
    const perTokenKey = `${SIGNALS_PREFIX}${signal.tokenKey}`;
    await redis.zadd(perTokenKey, { score: ts, member: JSON.stringify(signal) });
    const perTokenCount = await redis.zcard(perTokenKey);
    if (perTokenCount > 200) {
      await redis.zremrangebyrank(perTokenKey, 0, perTokenCount - 200 - 1);
    }
  }

  async updateSignal(signal: StoredSignal): Promise<void> {
    // Sorted sets do Redis não suportam "editar em posição" — removemos a versão
    // antiga (pelo mesmo score/timestamp) e voltamos a inserir a atualizada.
    const redis = getClient();
    const ts = new Date(signal.timestamp).getTime();
    const perTokenKey = `${SIGNALS_PREFIX}${signal.tokenKey}`;
    const old = await redis.zrange<string[]>(perTokenKey, ts, ts, { byScore: true });
    for (const raw of old) {
      const parsed = typeof raw === "string" ? (JSON.parse(raw) as StoredSignal) : (raw as unknown as StoredSignal);
      if (parsed.id === signal.id) await redis.zrem(perTokenKey, raw);
    }
    await redis.zadd(perTokenKey, { score: ts, member: JSON.stringify(signal) });

    const oldGlobal = await redis.zrange<string[]>(SIGNALS_ALL_KEY, ts, ts, { byScore: true });
    for (const raw of oldGlobal) {
      const parsed = typeof raw === "string" ? (JSON.parse(raw) as StoredSignal) : (raw as unknown as StoredSignal);
      if (parsed.id === signal.id) await redis.zrem(SIGNALS_ALL_KEY, raw);
    }
    await redis.zadd(SIGNALS_ALL_KEY, { score: ts, member: JSON.stringify(signal) });
  }

  async getRecentSignals(tokenKey: string | null, limit: number): Promise<StoredSignal[]> {
    const redis = getClient();
    const key = tokenKey ? `${SIGNALS_PREFIX}${tokenKey}` : SIGNALS_ALL_KEY;
    const raw = await redis.zrange<string[]>(key, 0, -1, { rev: true });
    const sliced = raw.slice(0, limit);
    return sliced.map((s) => (typeof s === "string" ? (JSON.parse(s) as StoredSignal) : (s as unknown as StoredSignal)));
  }

  async getSignalsPendingOutcomes(olderThanMs: number, limit: number): Promise<StoredSignal[]> {
    const redis = getClient();
    const cutoff = Date.now() - olderThanMs;
    const raw = await redis.zrange<string[]>(SIGNALS_ALL_KEY, 0, cutoff, { byScore: true });
    const signals = raw
      .map((s) => (typeof s === "string" ? (JSON.parse(s) as StoredSignal) : (s as unknown as StoredSignal)))
      .filter(hasPendingOutcome);
    return signals.slice(0, limit);
  }

  async getLastClassification(tokenKey: string): Promise<LastClassificationState | null> {
    const redis = getClient();
    const raw = await redis.get<LastClassificationState>(`${LAST_CLASS_PREFIX}${tokenKey}`);
    return raw ?? null;
  }

  async setLastClassification(tokenKey: string, state: LastClassificationState, ttlSeconds?: number): Promise<void> {
    const redis = getClient();
    if (ttlSeconds) await redis.set(`${LAST_CLASS_PREFIX}${tokenKey}`, state, { ex: ttlSeconds });
    else await redis.set(`${LAST_CLASS_PREFIX}${tokenKey}`, state);
  }

  async deleteLastClassification(tokenKey: string): Promise<void> {
    const redis = getClient();
    await redis.del(`${LAST_CLASS_PREFIX}${tokenKey}`);
  }

  async setCurrentTokenState(state: CurrentTokenState, ttlSeconds?: number): Promise<void> {
    const redis = getClient();
    const key = `${CURRENT_STATE_PREFIX}${state.tokenKey}`;
    if (ttlSeconds) await redis.set(key, state, { ex: ttlSeconds });
    else await redis.set(key, state);
    await redis.sadd(CURRENT_STATE_INDEX, state.tokenKey);
  }

  async getCurrentTokenState(tokenKey: string): Promise<CurrentTokenState | null> {
    const redis = getClient();
    const raw = await redis.get<CurrentTokenState>(`${CURRENT_STATE_PREFIX}${tokenKey}`);
    return raw ?? null;
  }

  async listCurrentTokenStates(): Promise<CurrentTokenState[]> {
    const redis = getClient();
    const keys = await redis.smembers(CURRENT_STATE_INDEX);
    if (!keys || keys.length === 0) return [];
    const results = await Promise.all(keys.map((k) => this.getCurrentTokenState(k)));
    const valid = results.filter((r): r is CurrentTokenState => r !== null);
    // limpa o índice de chaves cujo valor já expirou (TTL) para não crescer para sempre
    const staleKeys = keys.filter((k, i) => results[i] === null);
    if (staleKeys.length > 0) await redis.srem(CURRENT_STATE_INDEX, ...staleKeys);
    return valid;
  }

  async deleteCurrentTokenState(tokenKey: string): Promise<void> {
    const redis = getClient();
    await redis.del(`${CURRENT_STATE_PREFIX}${tokenKey}`);
    await redis.srem(CURRENT_STATE_INDEX, tokenKey);
  }

  async setRadarCandidate(state: RadarCandidateState, ttlSeconds?: number): Promise<void> {
    const redis = getClient(); const key = `${RADAR_PREFIX}${state.tokenKey}`;
    if (ttlSeconds) await redis.set(key, state, { ex: ttlSeconds }); else await redis.set(key, state);
    await redis.sadd(RADAR_INDEX, state.tokenKey);
  }
  async getRadarCandidate(tokenKey: string): Promise<RadarCandidateState | null> { return (await getClient().get<RadarCandidateState>(`${RADAR_PREFIX}${tokenKey}`)) ?? null; }
  async listRadarCandidates(): Promise<RadarCandidateState[]> {
    const redis = getClient(); const keys = await redis.smembers(RADAR_INDEX); if (!keys?.length) return [];
    const vals = await Promise.all(keys.map((k) => this.getRadarCandidate(k))); const stale = keys.filter((_, i) => vals[i] === null);
    if (stale.length) await redis.srem(RADAR_INDEX, ...stale); return vals.filter((v): v is RadarCandidateState => v !== null);
  }

  async upsertTradingPosition(position: TradingPosition): Promise<void> {
    const redis = getClient();
    await redis.set(`${TRADING_POSITION_PREFIX}${position.id}`, position);
    await redis.sadd(TRADING_POSITION_INDEX, position.id);
  }

  async getTradingPosition(id: string): Promise<TradingPosition | null> {
    return (await getClient().get<TradingPosition>(`${TRADING_POSITION_PREFIX}${id}`)) ?? null;
  }

  async listTradingPositions(): Promise<TradingPosition[]> {
    const redis = getClient();
    const ids = await redis.smembers(TRADING_POSITION_INDEX);
    if (!ids?.length) return [];
    const values = await Promise.all(ids.map((id) => this.getTradingPosition(id)));
    const stale = ids.filter((_, i) => values[i] === null);
    if (stale.length) await redis.srem(TRADING_POSITION_INDEX, ...stale);
    return values.filter((v): v is TradingPosition => v !== null);
  }

  async setMonitorHealth(health: MonitorHealth): Promise<void> {
    const redis = getClient();
    await redis.set(MONITOR_HEALTH_KEY, health);
  }

  async getMonitorHealth(): Promise<MonitorHealth | null> {
    const redis = getClient();
    const raw = await redis.get<MonitorHealth>(MONITOR_HEALTH_KEY);
    return raw ?? null;
  }
}
