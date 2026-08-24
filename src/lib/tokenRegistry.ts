import { Chain, TokenDefinition } from "./types";
import { getStorage, WatchedTokenRecord, watchedTokenKey } from "./storage";

// ---------------------------------------------------------------------------
// Registo unificado de tokens vigiados (Fase 1 do pedido).
// ---------------------------------------------------------------------------
// Antes desta mudança, um token adicionado manualmente via AddTokenPanel só
// existia em localStorage e nunca entrava no pipeline de dados. Agora, TODOS
// os tokens vigiados (descobertos automaticamente OU adicionados manualmente)
// vivem numa única fonte de verdade no servidor (lib/storage), identificados
// sempre por chain+endereço de contrato (nunca só pelo símbolo).
// ---------------------------------------------------------------------------

const DISCOVERY_STALE_MS = 6 * 60 * 60_000; // 6h sem aparecer no discovery -> deixa de ser vigiado (só os "discovery")

/** Regista (ou atualiza) um token adicionado manualmente pelo utilizador via AddTokenPanel. */
export async function registerManualToken(input: {
  chain: Chain;
  address: string;
  coingeckoId?: string | null;
  symbol: string;
  name?: string;
}): Promise<WatchedTokenRecord> {
  const storage = getStorage();
  const key = watchedTokenKey({ chain: input.chain, address: input.address });
  const now = new Date().toISOString();

  const existing = (await storage.listWatchedTokens()).find((t) => t.key === key);

  const record: WatchedTokenRecord = {
    key,
    source: "manual",
    coingeckoId: input.coingeckoId ?? existing?.coingeckoId ?? null,
    symbol: input.symbol,
    name: input.name ?? existing?.name ?? input.symbol,
    chain: input.chain,
    contractAddress: input.address,
    addedAt: existing?.addedAt ?? now,
    lastSeenAt: now,
    priority: 100, // tokens manuais têm prioridade máxima de atualização
  };

  await storage.upsertWatchedToken(record);
  return record;
}

/** Chamado pelo job de monitorização para manter os tokens descobertos automaticamente no registo. */
export async function upsertDiscoveredToken(def: TokenDefinition, rankScore: number): Promise<void> {
  const storage = getStorage();
  const key = watchedTokenKey({ chain: def.chain, address: def.contractAddress, coingeckoId: def.coingeckoId });
  const now = new Date().toISOString();
  const existing = (await storage.listWatchedTokens()).find((t) => t.key === key);

  // Não sobrescreve um token que o utilizador tenha adicionado manualmente.
  if (existing?.source === "manual") {
    await storage.upsertWatchedToken({ ...existing, lastSeenAt: now });
    return;
  }

  const record: WatchedTokenRecord = {
    key,
    source: "discovery",
    coingeckoId: def.coingeckoId,
    symbol: def.symbol,
    name: def.name,
    chain: def.chain,
    contractAddress: def.contractAddress,
    addedAt: existing?.addedAt ?? now,
    lastSeenAt: now,
    priority: Math.round(rankScore),
  };
  await storage.upsertWatchedToken(record);
}

/** Lista todos os tokens vigiados, descartando tokens "discovery" que já não aparecem há muito tempo. */
export async function listWatchedTokens(): Promise<WatchedTokenRecord[]> {
  const storage = getStorage();
  const all = await storage.listWatchedTokens();
  const cutoff = Date.now() - DISCOVERY_STALE_MS;
  const fresh: WatchedTokenRecord[] = [];
  for (const t of all) {
    if (t.source === "manual") {
      fresh.push(t);
      continue;
    }
    if (new Date(t.lastSeenAt).getTime() >= cutoff) {
      fresh.push(t);
    } else {
      await storage.removeWatchedToken(t.key);
    }
  }
  return fresh;
}

export async function removeWatchedToken(key: string): Promise<void> {
  await getStorage().removeWatchedToken(key);
}

/** Marca que o job de monitorização acabou de processar este token — usado para o fairness batching (Fase 12). */
export async function touchProcessed(key: string): Promise<void> {
  const storage = getStorage();
  const existing = (await storage.listWatchedTokens()).find((t) => t.key === key);
  if (!existing) return;
  await storage.upsertWatchedToken({ ...existing, lastProcessedAt: new Date().toISOString() });
}

/**
 * Remove um token adicionado manualmente (Fase 2 do hardening).
 * Ação idempotente: remover um token já removido (ou nunca registado) não é erro.
 *
 * Política de retenção documentada: apaga-se o registo de vigilância, o
 * estado atual (CurrentTokenState) e a última classificação — deixam de
 * fazer sentido para um token que já não é monitorizado. Os SINAIS
 * históricos (StoredSignal) são deliberadamente CONSERVADOS, para auditoria
 * e para não invalidar dados já usados em backtesting.
 */
export async function removeManualToken(key: string): Promise<{ removed: boolean; reason?: string }> {
  const storage = getStorage();
  const existing = (await storage.listWatchedTokens()).find((t) => t.key === key);

  if (!existing) {
    return { removed: false, reason: "not_found" };
  }
  if (existing.source !== "manual") {
    return { removed: false, reason: "not_manual" };
  }

  await storage.removeWatchedToken(key);
  await storage.deleteCurrentTokenState(key);
  await storage.deleteLastClassification(key);
  // Sinais (StoredSignal) NÃO são apagados — ver política de retenção acima.

  return { removed: true };
}
