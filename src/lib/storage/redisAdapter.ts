import { Redis } from "@upstash/redis";
import {
  LastClassificationState,
  Snapshot,
  StorageAdapter,
  StoredSignal,
  WatchedTokenRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Adaptador de armazenamento persistente (Redis via Upstash).
// ---------------------------------------------------------------------------
// Variáveis de ambiente necessárias em produção (ver README para instruções):
//   KV_REST_API_URL / KV_REST_API_TOKEN
//   (nomes injetados automaticamente ao instalar a integração "Upstash for
//   Redis" a partir do Vercel Marketplace; se a instalares com outro nome,
//   também aceitamos UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
// ---------------------------------------------------------------------------

const WATCHED_TOKENS_KEY = "memescope:watched-tokens";
const SIGNALS_ALL_KEY = "memescope:signals:all";
const SIGNALS_PREFIX = "memescope:signals:token:";
const SNAPSHOTS_PREFIX = "memescope:snapshots:";
const LAST_CLASS_PREFIX = "memescope:last-classification:";

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

  async appendSnapshot(snapshot: Snapshot, maxHistory: number): Promise<void> {
    const redis = getClient();
    const key = `${SNAPSHOTS_PREFIX}${snapshot.tokenKey}`;
    await redis.zadd(key, { score: snapshot.timestamp, member: JSON.stringify(snapshot) });
    // mantém só as últimas `maxHistory` entradas (remove as mais antigas)
    const count = await redis.zcard(key);
    if (count > maxHistory) {
      await redis.zremrangebyrank(key, 0, count - maxHistory - 1);
    }
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

  async getRecentSignals(tokenKey: string | null, limit: number): Promise<StoredSignal[]> {
    const redis = getClient();
    const key = tokenKey ? `${SIGNALS_PREFIX}${tokenKey}` : SIGNALS_ALL_KEY;
    const raw = await redis.zrange<string[]>(key, 0, -1, { rev: true });
    const sliced = raw.slice(0, limit);
    return sliced.map((s) => (typeof s === "string" ? (JSON.parse(s) as StoredSignal) : (s as unknown as StoredSignal)));
  }

  async getLastClassification(tokenKey: string): Promise<LastClassificationState | null> {
    const redis = getClient();
    const raw = await redis.get<LastClassificationState>(`${LAST_CLASS_PREFIX}${tokenKey}`);
    return raw ?? null;
  }

  async setLastClassification(tokenKey: string, state: LastClassificationState): Promise<void> {
    const redis = getClient();
    await redis.set(`${LAST_CLASS_PREFIX}${tokenKey}`, state);
  }
}
