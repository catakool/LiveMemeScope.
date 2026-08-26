// Cache em memória simples, com TTL, para reduzir chamadas às APIs externas
// e respeitar os limites de taxa (rate limits). Reinicia quando o servidor reinicia.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  storedAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): { value: T; storedAt: number } | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return { value: entry.value, storedAt: entry.storedAt };
}

/** Devolve o valor mesmo expirado, útil como fallback quando a API externa falha. */
export function cacheGetStale<T>(key: string): { value: T; storedAt: number } | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  return { value: entry.value, storedAt: entry.storedAt };
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs, storedAt: Date.now() });
}

/** Evita pedidos duplicados em paralelo para a mesma chave (request coalescing). */
const inFlight = new Map<string, Promise<unknown>>();

export async function withCoalescing<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}
