import { getDiscoveryFeed, mapWithConcurrency } from "./discovery";
import { upsertDiscoveredToken, listWatchedTokens, touchProcessed } from "./tokenRegistry";
import { getMarkets } from "./coingecko";
import { getDexDataByAddress } from "./dexscreener";
import { computeOpportunity, OpportunityClassification } from "./opportunity";
import { OPPORTUNITY_CONFIG } from "./opportunityConfig";
import { getStorage, Snapshot, StoredSignal, WatchedTokenRecord } from "./storage";
import { MarketData, DexPairData } from "./types";
import { NULL_CATALYST_PROVIDER } from "./catalystProvider";

// ---------------------------------------------------------------------------
// Job de monitorização (Fase 4, com melhorias de hardening: fairness,
// CurrentTokenState persistido, TTLs e preenchimento de outcomes para
// backtesting). Pensado para correr num Vercel Cron Job / agendador externo,
// NUNCA num setInterval de uma função serverless.
// ---------------------------------------------------------------------------

const CFG = OPPORTUNITY_CONFIG;

const TIER_RANK: Record<OpportunityClassification, number> = {
  no_signal: 0,
  watch: 1,
  high_momentum_watch: 2,
  strong_opportunity: 3,
  very_strong_opportunity: 4,
};

function buildSnapshot(token: WatchedTokenRecord, market: MarketData | null, dex: DexPairData | null): Snapshot {
  return {
    tokenKey: token.key,
    chain: token.chain,
    address: token.contractAddress,
    coingeckoId: token.coingeckoId,
    timestamp: Date.now(),
    price: market?.price ?? dex?.priceUsd ?? null,
    marketCap: market?.marketCap ?? null,
    liquidityUsd: dex?.liquidityUsd ?? null,
    volumeM5: dex?.volumeM5 ?? null,
    volumeH1: dex?.volumeH1 ?? null,
    volumeH6: dex?.volumeH6 ?? null,
    volumeH24: dex?.volume24hUsd ?? market?.volume24h ?? null,
    buysM5: dex?.txnsM5?.buys ?? null,
    sellsM5: dex?.txnsM5?.sells ?? null,
    buysH1: dex?.txnsH1?.buys ?? null,
    sellsH1: dex?.txnsH1?.sells ?? null,
    buysH6: dex?.txnsH6?.buys ?? null,
    sellsH6: dex?.txnsH6?.sells ?? null,
    buysH24: dex?.txns24h?.buys ?? null,
    sellsH24: dex?.txns24h?.sells ?? null,
  };
}

export interface MonitorCycleSummary {
  tokensConsidered: number;
  tokensProcessed: number;
  tokensSkipped: number;
  snapshotsSaved: number;
  signalsGenerated: number;
  outcomesBackfilled: number;
  storage: "redis" | "memory";
  durationMs: number;
  errors: string[];
}

/**
 * Ordena os tokens vigiados por prioridade justa (Fase 12): manuais primeiro,
 * depois quem há mais tempo não é processado (evita starvation quando há
 * muitos tokens manuais), com a prioridade/rankScore do discovery como
 * critério de desempate.
 */
function fairOrder(tokens: WatchedTokenRecord[]): WatchedTokenRecord[] {
  const now = Date.now();
  const staleness = (t: WatchedTokenRecord) => (t.lastProcessedAt ? now - new Date(t.lastProcessedAt).getTime() : Infinity);
  return [...tokens].sort((a, b) => {
    if (a.source !== b.source) return a.source === "manual" ? -1 : 1;
    const stalenessDiff = staleness(b) - staleness(a);
    if (Math.abs(stalenessDiff) > 5 * 60_000) return stalenessDiff; // diferença relevante de "há quanto tempo não processa"
    return b.priority - a.priority;
  });
}

/**
 * Seleciona sinais pendentes de forma equilibrada por horizonte. O mesmo sinal
 * pode ser candidato em vários horizontes; o Map deduplica-o antes do fetch.
 * Assim, um +5m que ficou N/D não bloqueia o +15m/+1h desse mesmo sinal.
 */
function selectPendingOutcomeSignals(signals: StoredSignal[], now: number): StoredSignal[] {
  const horizons: { priceKey: keyof StoredSignal; offsetMs: number }[] = [
    { priceKey: "priceAt5m", offsetMs: 5 * 60_000 },
    { priceKey: "priceAt15m", offsetMs: 15 * 60_000 },
    { priceKey: "priceAt1h", offsetMs: 60 * 60_000 },
    { priceKey: "priceAt6h", offsetMs: 6 * 60 * 60_000 },
    { priceKey: "priceAt24h", offsetMs: 24 * 60 * 60_000 },
  ];
  const selected = new Map<string, StoredSignal>();
  for (const { priceKey, offsetMs } of horizons) {
    const group = signals
      .filter((sig) =>
        (sig[priceKey] === undefined || sig[priceKey] === null) &&
        now >= new Date(sig.timestamp).getTime() + offsetMs
      )
      .sort((a, b) =>
        (new Date(b.timestamp).getTime() + offsetMs) -
        (new Date(a.timestamp).getTime() + offsetMs)
      )
      .slice(0, CFG.outcomes.candidatesPerHorizon);
    for (const sig of group) selected.set(sig.id, sig);
  }
  return [...selected.values()];
}

/** Preenche outcomes usando tolerâncias explícitas; N/D é preferível a uma janela errada. */
async function backfillSignalOutcomes(storage: ReturnType<typeof getStorage>): Promise<number> {
  const now = Date.now();
  const scanned = await storage.getSignalsPendingOutcomes(5 * 60_000, CFG.outcomes.pendingScanLimit);
  const pending = selectPendingOutcomeSignals(scanned, now);
  let filled = 0;

  for (const signal of pending) {
    const signalTs = new Date(signal.timestamp).getTime();
    const snapshots = await storage.getRecentSnapshots(signal.tokenKey, signalTs - 60_000);
    if (snapshots.length === 0) continue;

    const findPriceAt = (offsetMs: number, toleranceMs: number): number | null => {
      const targetTs = signalTs + offsetMs;
      if (now < targetTs) return null;
      let best: Snapshot | null = null;
      let bestDiff = Infinity;
      for (const snap of snapshots) {
        if (snap.price === null) continue;
        const diff = Math.abs(snap.timestamp - targetTs);
        if (diff < bestDiff) { best = snap; bestDiff = diff; }
      }
      if (!best || bestDiff > toleranceMs) return null;
      return best.price;
    };

    const updated: StoredSignal = { ...signal };
    let changed = false;
    const tol = CFG.outcomes.toleranceMs;
    const horizons: [keyof StoredSignal, keyof StoredSignal, number, number][] = [
      ["priceAt5m", "return5m", 5 * 60_000, tol.m5],
      ["priceAt15m", "return15m", 15 * 60_000, tol.m15],
      ["priceAt1h", "return1h", 60 * 60_000, tol.h1],
      ["priceAt6h", "return6h", 6 * 60 * 60_000, tol.h6],
      ["priceAt24h", "return24h", 24 * 60 * 60_000, tol.h24],
    ];
    for (const [priceKey, returnKey, offsetMs, toleranceMs] of horizons) {
      if (updated[priceKey] === undefined || updated[priceKey] === null) {
        const price = findPriceAt(offsetMs, toleranceMs);
        if (price !== null) {
          (updated as unknown as Record<string, number | null>)[priceKey as string] = price;
          if (signal.price && signal.price > 0) (updated as unknown as Record<string, number | null>)[returnKey as string] = ((price - signal.price) / signal.price) * 100;
          changed = true;
        }
      }
    }

    if (changed) {
      const prices = snapshots.filter((snap) => snap.timestamp >= signalTs && snap.price !== null).map((snap) => snap.price as number);
      if (prices.length > 0 && signal.price) {
        const currentMfe = ((Math.max(...prices) - signal.price) / signal.price) * 100;
        const currentMae = ((Math.min(...prices) - signal.price) / signal.price) * 100;
        updated.maxFavorableExcursion = Math.max(updated.maxFavorableExcursion ?? -Infinity, currentMfe);
        updated.maxAdverseExcursion = Math.min(updated.maxAdverseExcursion ?? Infinity, currentMae);
      }
      await storage.updateSignal(updated);
      filled += 1;
    }
  }
  return filled;
}

export async function runMonitorCycle(): Promise<MonitorCycleSummary> {
  const start = Date.now();
  const storage = getStorage();
  const errors: string[] = [];

  let discoveryRecords: Awaited<ReturnType<typeof getDiscoveryFeed>>["records"] = [];
  try {
    const discovery = await getDiscoveryFeed();
    discoveryRecords = discovery.records;
    await Promise.all(discoveryRecords.map((r) => upsertDiscoveredToken(r.def, r.discovery.rankScore)));
  } catch (err) {
    errors.push(`discovery: ${(err as Error).message}`);
  }

  const watched = await listWatchedTokens();
  const ordered = fairOrder(watched);
  const batch = ordered.slice(0, CFG.monitor.maxTokensPerRun);
  const tokensSkipped = Math.max(0, watched.length - batch.length);

  const discoveryByKey = new Map(discoveryRecords.map((r) => [r.def.tokenKey, r]));

  const needsMarket = batch.filter((t) => !discoveryByKey.has(t.key) && t.coingeckoId);
  const marketIds = Array.from(new Set(needsMarket.map((t) => t.coingeckoId as string)));
  let extraMarkets: Record<string, MarketData> = {};
  if (marketIds.length > 0) {
    try {
      const { data } = await getMarkets(marketIds);
      extraMarkets = data;
    } catch (err) {
      errors.push(`markets: ${(err as Error).message}`);
    }
  }

  const needsDex = batch.filter((t) => !discoveryByKey.has(t.key) && t.contractAddress);
  const extraDexEntries = await mapWithConcurrency(needsDex, 5, async (t) => {
    try {
      const { data } = await getDexDataByAddress(t.contractAddress as string, t.chain);
      return { key: t.key, data };
    } catch (err) {
      errors.push(`dex(${t.symbol}): ${(err as Error).message}`);
      return { key: t.key, data: null as DexPairData | null };
    }
  });
  const extraDexByKey = new Map(extraDexEntries.map((e) => [e.key, e.data]));

  let snapshotsSaved = 0;
  let signalsGenerated = 0;
  let tokensProcessed = 0;

  for (const token of batch) {
    try {
      const discoveryHit = discoveryByKey.get(token.key);
      const market: MarketData | null = discoveryHit?.market ?? (token.coingeckoId ? extraMarkets[token.coingeckoId] ?? null : null);
      const dex: DexPairData | null = discoveryHit?.dex ?? extraDexByKey.get(token.key) ?? null;

      if (!market && !dex) continue;

      const previous = await storage.getRecentSnapshots(token.key, Date.now() - CFG.monitor.snapshotLookbackMs);
      const newSnapshot = buildSnapshot(token, market, dex);
      const combined = [...previous, newSnapshot];

      const catalysts = await NULL_CATALYST_PROVIDER.getCatalysts({
        coingeckoId: token.coingeckoId,
        chain: token.chain,
        address: token.contractAddress,
      });
      const opportunity = computeOpportunity(combined, market, dex, catalysts);

      await storage.appendSnapshot(newSnapshot, CFG.monitor.snapshotHistoryLimit, CFG.retention.snapshotTtlSeconds);
      snapshotsSaved += 1;
      tokensProcessed += 1;
      await touchProcessed(token.key);

      // Persiste o estado "pronto a mostrar" para o dashboard ler sem recalcular (Fase 11).
      await storage.setCurrentTokenState(
        {
          tokenKey: token.key,
          updatedAt: new Date().toISOString(),
          latestSnapshotAgeMs: 0,
          marketRaw: market,
          dexRaw: dex,
          opportunityRaw: opportunity,
        },
        CFG.retention.currentStateTtlSeconds
      );

      const last = await storage.getLastClassification(token.key);
      const lastRank = last ? TIER_RANK[last.classification] : -1;
      const newRank = TIER_RANK[opportunity.classification];
      const lastSignalAtMs = last?.lastSignalAt ? new Date(last.lastSignalAt).getTime() : 0;
      const serverCooldownElapsed = Date.now() - lastSignalAtMs >= CFG.alerts.serverSignalCooldownMs;
      let emittedSignalAt: string | null = null;

      if (opportunity.classification !== "no_signal" && newRank > lastRank && serverCooldownElapsed) {
        const signal: StoredSignal = {
          id: `${token.key}-${Date.now()}`,
          tokenKey: token.key,
          coingeckoId: token.coingeckoId,
          chain: token.chain,
          address: token.contractAddress,
          symbol: token.symbol,
          timestamp: new Date().toISOString(),
          price: newSnapshot.price,
          marketCap: newSnapshot.marketCap,
          liquidityUsd: newSnapshot.liquidityUsd,
          volumeH24: newSnapshot.volumeH24,
          opportunityScore: opportunity.total,
          components: { ...opportunity.components },
          confidence: opportunity.confidence,
          classification: opportunity.classification,
          reasons: opportunity.reasons,
          risks: opportunity.risks,
          invalidatedByRisk: opportunity.invalidatedByRisk,
        };
        await storage.appendSignal(signal, CFG.monitor.signalGlobalHistoryLimit);
        signalsGenerated += 1;
        emittedSignalAt = signal.timestamp;
      }

      await storage.setLastClassification(
        token.key,
        {
          classification: opportunity.classification,
          score: opportunity.total,
          timestamp: new Date().toISOString(),
          lastSignalAt: emittedSignalAt ?? last?.lastSignalAt ?? null,
        },
        CFG.retention.lastClassificationTtlSeconds
      );
    } catch (err) {
      errors.push(`token(${token.symbol}): ${(err as Error).message}`);
    }
  }

  let outcomesBackfilled = 0;
  try {
    outcomesBackfilled = await backfillSignalOutcomes(storage);
  } catch (err) {
    errors.push(`backfill: ${(err as Error).message}`);
  }

  const durationMs = Date.now() - start;
  const summary: MonitorCycleSummary = {
    tokensConsidered: watched.length,
    tokensProcessed,
    tokensSkipped,
    snapshotsSaved,
    signalsGenerated,
    outcomesBackfilled,
    storage: storage.kind,
    durationMs,
    errors,
  };

  try {
    await storage.setMonitorHealth({
      lastRunAt: new Date().toISOString(),
      durationMs,
      tokensConsidered: summary.tokensConsidered,
      tokensProcessed: summary.tokensProcessed,
      tokensSkipped: summary.tokensSkipped,
      snapshotsSaved: summary.snapshotsSaved,
      signalsGenerated: summary.signalsGenerated,
      apiFailures: errors.length,
      storageKind: storage.kind,
    });
  } catch {
    // a saúde do monitor é diagnóstica; não deve derrubar o ciclo se falhar a gravar
  }

  return summary;
}
