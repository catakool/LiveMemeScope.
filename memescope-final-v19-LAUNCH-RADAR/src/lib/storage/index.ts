import { isRedisConfigured, RedisStorageAdapter } from "./redisAdapter";
import { MemoryStorageAdapter } from "./memoryAdapter";
import { StorageAdapter } from "./types";

let adapter: StorageAdapter | null = null;

/**
 * Devolve o adaptador de armazenamento ativo. Usa Redis (Upstash) quando
 * KV_REST_API_URL/KV_REST_API_TOKEN estão definidas; caso contrário usa um
 * fallback em memória (não persistente, apenas para desenvolvimento local —
 * ver lib/storage/memoryAdapter.ts).
 */
export function getStorage(): StorageAdapter {
  if (!adapter) {
    adapter = isRedisConfigured() ? new RedisStorageAdapter() : new MemoryStorageAdapter();
  }
  return adapter;
}

export * from "./types";
