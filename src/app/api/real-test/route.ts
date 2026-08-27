import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Redis } from "@upstash/redis";
import { randomUUID } from "node:crypto";
import {
  circuitBreaker,
  classifyBuyError,
  marketCapSolFromFill,
  sellPlanForRetry,
  shouldQuarantineUnsellablePosition,
  type StopReason,
} from "@/lib/realTradingLogic";

export const runtime = "nodejs";

const MAX_ENTRIES = 20;
const STATE_KEY = "memescope:real-test:v22"; // keep legacy key: preserves the live 6/20 state
const LOCK_KEY = `${STATE_KEY}:trade-lock`;
const DEFAULT_RESERVE_SOL = 0.003;
const DEFAULT_BUY_FRACTION = 0.20;
const DEFAULT_BUY_SLIPPAGE = 6;
const DEFAULT_SELL_SLIPPAGE = 12;
const DEFAULT_PRIORITY_FEE = 0.00005;
const DEFAULT_MAX_BUY_COST_PCT = 5;
const DEFAULT_MAX_ENTRY_GAP_PCT = 12;
const DEFAULT_MAX_CONSECUTIVE_LOSSES = 4;
const DEFAULT_MAX_DRAWDOWN_PCT = 30;
const DEFAULT_STALE_POSITION_MS = 120_000;
const DEFAULT_QUARANTINE_AFTER_MS = 15 * 60_000;
const WSOL_MINT = "So11111111111111111111111111111111111111112";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// NOTE: token-program validation is intentionally permissive when reading balances.
// getParsedTokenAccountsByOwner({mint}) already asks the RPC for token accounts for that mint.

interface TokenSnapshot {
  raw: string;
  decimals: number;
  accounts: Array<{ pubkey: PublicKey; ownerProgram: PublicKey; raw: string }>;
}

type QuarantinedPosition = {
  mint: string;
  name: string | null;
  symbol: string | null;
  raw: string | null;
  decimals: number | null;
  quarantinedAt: number;
  reason: string;
};

type RealState = {
  entries: number;
  openMint: string | null;
  stopped: boolean;
  armed?: boolean;
  stopReason?: StopReason;
  // openEntryMarketCapSol is the REAL effective fill anchor when available.
  openEntryMarketCapSol?: number | null;
  openSignalMarketCapSol?: number | null;
  openEntryGapPct?: number | null;
  openName?: string | null;
  openSymbol?: string | null;
  openOpenedAt?: number | null;
  openBalanceBeforeBuySol?: number | null;
  openBalanceAfterBuySol?: number | null;
  openTokenAmountRaw?: string | null;
  openTokenDecimals?: number | null;
  realizedPnlSol?: number;
  wins?: number;
  losses?: number;
  consecutiveLosses?: number;
  peakWalletBalanceSol?: number | null;
  lastTradePnlSol?: number | null;
  lastTradeReturnPct?: number | null;
  lastPaperMirrorReturnPct?: number | null;
  lastSignalReturnPct?: number | null;
  lastEntryGapPct?: number | null;
  lastExecutionGapPct?: number | null;
  skippedBuys?: number;
  lastSkipReason?: string | null;
  exitRequested?: boolean;
  sellRetryCount?: number;
  sellRetrySince?: number | null;
  lastSellAttemptAt?: number | null;
  lastSellError?: string | null;
  abandonedMints?: string[];
  abandonedCount?: number;
  lastAbandonedMint?: string | null;
  quarantinedPositions?: QuarantinedPosition[];
  lastQuarantineReason?: string | null;
  lastAction: string | null;
  lastSignature: string | null;
  lastError: string | null;
  startedAt: number | null;
};

const emptyState = (): RealState => ({
  entries: 0,
  openMint: null,
  stopped: false,
  armed: false,
  stopReason: null,
  openEntryMarketCapSol: null,
  openSignalMarketCapSol: null,
  openEntryGapPct: null,
  openName: null,
  openSymbol: null,
  openOpenedAt: null,
  openBalanceBeforeBuySol: null,
  openBalanceAfterBuySol: null,
  openTokenAmountRaw: null,
  openTokenDecimals: null,
  realizedPnlSol: 0,
  wins: 0,
  losses: 0,
  consecutiveLosses: 0,
  peakWalletBalanceSol: null,
  lastTradePnlSol: null,
  lastTradeReturnPct: null,
  lastPaperMirrorReturnPct: null,
  lastSignalReturnPct: null,
  lastEntryGapPct: null,
  lastExecutionGapPct: null,
  skippedBuys: 0,
  lastSkipReason: null,
  exitRequested: false,
  sellRetryCount: 0,
  sellRetrySince: null,
  lastSellAttemptAt: null,
  lastSellError: null,
  abandonedMints: [],
  abandonedCount: 0,
  lastAbandonedMint: null,
  quarantinedPositions: [],
  lastQuarantineReason: null,
  lastAction: null,
  lastSignature: null,
  lastError: null,
  startedAt: null,
});

function redisClient() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("REAL TEST requiere Upstash Redis para aplicar los límites y recuperar posiciones.");
  return new Redis({ url, token });
}

function parseKeypair() {
  const raw = process.env.REAL_WALLET_PRIVATE_KEY?.trim();
  if (!raw) throw new Error("REAL_WALLET_PRIVATE_KEY no configurada.");
  if (raw.startsWith("[")) {
    const a = JSON.parse(raw);
    return Keypair.fromSecretKey(Uint8Array.from(a));
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function rpcUrl() {
  return process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
}

function authorized(req: NextRequest) {
  const x = process.env.REAL_CONTROL_TOKEN?.trim();
  return Boolean(x && req.headers.get("x-real-control-token") === x);
}

async function getState(r: Redis): Promise<RealState> {
  const raw = (await r.get<RealState>(STATE_KEY)) ?? emptyState();
  const inferredStopReason: StopReason = raw.stopReason ?? (raw.stopped && raw.lastAction === "KILL SWITCH" ? "manual" : null);
  return {
    ...emptyState(),
    ...raw,
    armed: Boolean(raw.armed),
    stopReason: inferredStopReason,
    realizedPnlSol: Number(raw.realizedPnlSol) || 0,
    wins: Number(raw.wins) || 0,
    losses: Number(raw.losses) || 0,
    consecutiveLosses: Number(raw.consecutiveLosses) || 0,
    skippedBuys: Number(raw.skippedBuys) || 0,
    sellRetryCount: Number(raw.sellRetryCount) || 0,
    abandonedCount: Number(raw.abandonedCount) || 0,
    abandonedMints: Array.isArray(raw.abandonedMints) ? raw.abandonedMints.slice(-50) : [],
    quarantinedPositions: Array.isArray(raw.quarantinedPositions) ? raw.quarantinedPositions.slice(-20) : [],
  };
}

async function saveState(r: Redis, s: RealState) {
  await r.set(STATE_KEY, s);
}

async function walletSnapshot(c: Connection, k: Keypair) {
  const lamports = await c.getBalance(k.publicKey, "confirmed");
  return { publicKey: k.publicKey.toBase58(), balanceSol: lamports / 1e9 };
}

async function tokenSnapshot(c: Connection, owner: PublicKey, mint: string): Promise<TokenSnapshot> {
  const response = await c.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) }, "confirmed");
  let raw = BigInt(0);
  let decimals = 0;
  const accounts: TokenSnapshot["accounts"] = [];
  for (const item of response.value) {
    const parsed = (item.account.data as any)?.parsed?.info;
    const amount = String(parsed?.tokenAmount?.amount ?? "0");
    decimals = Number(parsed?.tokenAmount?.decimals ?? decimals) || 0;
    try { raw += BigInt(amount); } catch {}
    accounts.push({ pubkey: item.pubkey, ownerProgram: item.account.owner, raw: amount });
  }
  return { raw: raw.toString(), decimals, accounts };
}

function rawPositive(raw: string | null | undefined) {
  try { return BigInt(raw ?? "0") > BigInt(0); } catch { return false; }
}

async function tokenSnapshotWithRetry(
  c: Connection,
  owner: PublicKey,
  mint: string,
  attempts = 3,
  delayMs = 450,
): Promise<TokenSnapshot> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await tokenSnapshot(c, owner, mint);
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("TOKEN_SNAPSHOT_FAILED");
}

async function waitForTokenChange(args: {
  c: Connection;
  owner: PublicKey;
  mint: string;
  beforeRaw: string;
  direction: "increase" | "zero";
  timeoutMs?: number;
}) {
  const deadline = Date.now() + (args.timeoutMs ?? 7_000);
  let latest = await tokenSnapshotWithRetry(args.c, args.owner, args.mint, 2, 250);
  while (Date.now() < deadline) {
    try {
      if (args.direction === "zero" && !rawPositive(latest.raw)) return latest;
      if (args.direction === "increase" && BigInt(latest.raw) > BigInt(args.beforeRaw)) return latest;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
    latest = await tokenSnapshotWithRetry(args.c, args.owner, args.mint, 2, 250);
  }
  return latest;
}

async function effectiveFillMarketCapSol(c: Connection, mint: string, inputSol: number, acquiredRaw: string) {
  try {
    const supply = await c.getTokenSupply(new PublicKey(mint), "confirmed");
    return marketCapSolFromFill({ inputSol, supplyRaw: supply.value.amount, acquiredRaw });
  } catch {
    return null;
  }
}

async function preBuyMintGuard(c: Connection, mint: string) {
  const info = await c.getParsedAccountInfo(new PublicKey(mint), "confirmed");
  if (!info.value) throw new Error("PREBUY_SKIP mint account unavailable");
  const program = info.value.owner.toBase58();
  // Direct Pump.fun launches are standard SPL tokens. Token-2022 can add transfer
  // hooks/fees/default frozen state that make a millisecond sniper materially less
  // predictable, so REAL mode fails closed on it while PAPER may still observe it.
  if (program !== TOKEN_PROGRAM_ID) {
    throw new Error(`PREBUY_SKIP unsupported token program ${program}`);
  }
  const parsed = (info.value.data as any)?.parsed?.info;
  if (parsed?.freezeAuthority) throw new Error("PREBUY_SKIP freeze authority active");
}

async function acquireTradeLock(r: Redis) {
  const id = randomUUID();
  const result = await r.set(LOCK_KEY, id, { nx: true, ex: 90 });
  return result === "OK" ? id : null;
}

async function releaseTradeLock(r: Redis, id: string) {
  try {
    const current = await r.get<string>(LOCK_KEY);
    if (current === id) await r.del(LOCK_KEY);
  } catch {}
}

async function waitForSignature(c: Connection, sig: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await c.getSignatureStatuses([sig], { searchTransactionHistory: true });
    const status = result.value[0];
    if (status?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  throw new Error(`TX_CONFIRM_TIMEOUT ${sig}`);
}

type PortalPool = "auto" | "pump" | "pump-amm" | "launchlab" | "bonk" | "raydium" | "raydium-cpmm";
async function portalTx(a: {
  publicKey: string;
  action: "buy" | "sell";
  mint: string;
  amount: number | string;
  denominatedInSol: "true" | "false";
  slippagePct?: number;
  pool?: PortalPool;
}) {
  const defaultSlippage = a.action === "buy"
    ? Number(process.env.REAL_BUY_SLIPPAGE_PCT ?? process.env.REAL_SLIPPAGE_PCT ?? DEFAULT_BUY_SLIPPAGE)
    : Number(process.env.REAL_SELL_SLIPPAGE_PCT ?? process.env.REAL_SLIPPAGE_PCT ?? DEFAULT_SELL_SLIPPAGE);
  const response = await fetch("https://pumpportal.fun/api/trade-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: a.publicKey,
      action: a.action,
      mint: a.mint,
      amount: a.amount,
      denominatedInSol: a.denominatedInSol,
      slippage: a.slippagePct ?? defaultSlippage,
      priorityFee: Number(process.env.REAL_PRIORITY_FEE_SOL ?? DEFAULT_PRIORITY_FEE),
      pool: a.pool ?? "auto",
    }),
  });
  if (!response.ok) throw new Error(`PumpPortal ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function simulateSigned(c: Connection, tx: VersionedTransaction) {
  const sim = await c.simulateTransaction(tx, { sigVerify: false, commitment: "processed" });
  if (sim.value.err) {
    const logs = (sim.value.logs ?? []).slice(-10).join(" | ");
    throw new Error(`SIMULATION_FAILED ${JSON.stringify(sim.value.err)} ${logs}`.slice(0, 1200));
  }
}

async function signAndSendVersioned(
  c: Connection,
  k: Keypair,
  bytes: Uint8Array,
  opts?: { buyAmountSol?: number; simulate?: boolean },
) {
  const tx = VersionedTransaction.deserialize(bytes);
  tx.sign([k]);
  if (opts?.simulate !== false) await simulateSigned(c, tx);

  let estimatedExecutionCostSol = 0;
  try {
    // getFeeForMessage already includes the prioritization fee encoded in the message.
    const feeInfo = await c.getFeeForMessage(tx.message, "confirmed");
    estimatedExecutionCostSol = (feeInfo.value ?? 0) / 1e9;
  } catch {}

  if (opts?.buyAmountSol && opts.buyAmountSol > 0) {
    const costPct = (estimatedExecutionCostSol / opts.buyAmountSol) * 100;
    const maxCostPct = Number(process.env.REAL_MAX_BUY_COST_PCT ?? DEFAULT_MAX_BUY_COST_PCT);
    if (Number.isFinite(costPct) && costPct > maxCostPct) {
      throw new Error(`PREBUY_SKIP execution cost ${costPct.toFixed(2)}% > ${maxCostPct.toFixed(2)}% limit`);
    }
  }

  const sig = await c.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
  try {
    await waitForSignature(c, sig);
  } catch (e) {
    const message = e instanceof Error ? e.message : "confirmation failed";
    // Preserve the signature so BUY/SELL callers can reconcile against token
    // balances rather than assuming a timeout means the transaction did not land.
    throw new Error(`${message} SENT_SIG=${sig}`);
  }
  return { sig, estimatedExecutionCostSol };
}

async function closeEmptyMintAccounts(c: Connection, k: Keypair, mint: string) {
  const snapshot = await tokenSnapshot(c, k.publicKey, mint);
  const empty = snapshot.accounts.filter((x) => x.raw === "0");
  if (!empty.length) return null;

  const instructions: TransactionInstruction[] = [];
  for (const account of empty.slice(0, 4)) {
    const program = account.ownerProgram.toBase58();
    if (program !== TOKEN_PROGRAM_ID && program !== TOKEN_2022_PROGRAM_ID) continue;
    instructions.push(new TransactionInstruction({
      programId: account.ownerProgram,
      keys: [
        { pubkey: account.pubkey, isSigner: false, isWritable: true },
        { pubkey: k.publicKey, isSigner: false, isWritable: true },
        { pubkey: k.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([9]), // SPL Token / Token-2022 CloseAccount
    }));
  }
  if (!instructions.length) return null;

  try {
    const latest = await c.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: k.publicKey, recentBlockhash: latest.blockhash }).add(...instructions);
    tx.sign(k);
    const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });
    await c.confirmTransaction({ signature: sig, ...latest }, "confirmed");
    return sig;
  } catch {
    // Rent recovery is useful but must never turn a successful SELL into a failed trade.
    return null;
  }
}

async function jupiterSell(k: Keypair, mint: string, rawAmount: string) {
  const apiKey = process.env.JUPITER_API_KEY?.trim();
  if (!apiKey) throw new Error("JUPITER_FALLBACK_NOT_CONFIGURED");
  const params = new URLSearchParams({
    inputMint: mint,
    outputMint: WSOL_MINT,
    amount: rawAmount,
    taker: k.publicKey.toBase58(),
  });
  const orderResponse = await fetch(`https://api.jup.ag/swap/v2/order?${params}`, {
    headers: { "x-api-key": apiKey },
    cache: "no-store",
  });
  if (!orderResponse.ok) throw new Error(`Jupiter order ${orderResponse.status}: ${(await orderResponse.text()).slice(0, 400)}`);
  const order = await orderResponse.json() as { transaction?: string | null; requestId?: string; errorCode?: number; errorMessage?: string };
  if (!order.transaction || !order.requestId) throw new Error(`Jupiter no executable route: ${order.errorCode ?? "?"} ${order.errorMessage ?? ""}`);
  const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  tx.sign([k]);
  const signedTransaction = Buffer.from(tx.serialize()).toString("base64");
  const executeResponse = await fetch("https://api.jup.ag/swap/v2/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ signedTransaction, requestId: order.requestId }),
  });
  if (!executeResponse.ok) throw new Error(`Jupiter execute ${executeResponse.status}: ${(await executeResponse.text()).slice(0, 400)}`);
  const result = await executeResponse.json() as { status?: string; signature?: string; error?: string; code?: number };
  if (result.status !== "Success" || !result.signature) throw new Error(`Jupiter failed ${result.code ?? "?"}: ${result.error ?? result.status ?? "unknown"}`);
  return result.signature;
}

function clearOpenFields(state: RealState): RealState {
  return {
    ...state,
    openMint: null,
    openEntryMarketCapSol: null,
    openSignalMarketCapSol: null,
    openEntryGapPct: null,
    openName: null,
    openSymbol: null,
    openOpenedAt: null,
    openBalanceBeforeBuySol: null,
    openBalanceAfterBuySol: null,
    openTokenAmountRaw: null,
    openTokenDecimals: null,
    exitRequested: false,
    sellRetryCount: 0,
    sellRetrySince: null,
    lastSellAttemptAt: null,
    lastSellError: null,
  };
}

async function finalizeExit(args: {
  r: Redis;
  state: RealState;
  c: Connection;
  k: Keypair;
  mint: string;
  signature?: string | null;
  paperExitMarketCapSol?: number | null;
  quarantined?: boolean;
  remainingRaw?: string | null;
  remainingDecimals?: number | null;
  quarantineReason?: string | null;
}) {
  const { r, state, c, k, mint } = args;
  if (!args.quarantined) await closeEmptyMintAccounts(c, k, mint);

  let walletAfter: { publicKey: string; balanceSol: number };
  let walletKnown = true;
  try {
    walletAfter = await walletSnapshot(c, k);
  } catch {
    walletKnown = false;
    walletAfter = {
      publicKey: k.publicKey.toBase58(),
      balanceSol: Number(state.openBalanceAfterBuySol ?? state.openBalanceBeforeBuySol ?? 0),
    };
  }

  const before = state.openBalanceBeforeBuySol == null ? null : Number(state.openBalanceBeforeBuySol);
  const afterBuy = state.openBalanceAfterBuySol == null ? null : Number(state.openBalanceAfterBuySol);
  // If a token is explicitly quarantined, treating the SOL that left the wallet on
  // BUY as lost is conservative and prevents an unsellable bag from looking like a
  // profitable/unknown trade. For a normal SELL, never fabricate PnL if the final
  // wallet snapshot itself failed.
  const pnlKnown = before != null && Number.isFinite(before) && before > 0 && (walletKnown || args.quarantined);
  const pnl = pnlKnown ? walletAfter.balanceSol - before : null;
  const spent = before != null && afterBuy != null && Number.isFinite(before) && Number.isFinite(afterBuy)
    ? Math.max(0, before - afterBuy)
    : 0;
  const tradeRet = pnl != null && spent > 0 ? (pnl / spent) * 100 : null;

  const paperExit = Number(args.paperExitMarketCapSol);
  const fillEntry = Number(state.openEntryMarketCapSol);
  const signalEntry = Number(state.openSignalMarketCapSol);
  const paperMirrorReturn = fillEntry > 0 && paperExit > 0 ? ((paperExit / fillEntry) - 1) * 100 : null;
  const signalReturn = signalEntry > 0 && paperExit > 0 ? ((paperExit / signalEntry) - 1) * 100 : null;
  const entryGap = Number(state.openEntryGapPct);
  const executionGap = paperMirrorReturn != null && tradeRet != null ? tradeRet - paperMirrorReturn : null;

  const realized = (Number(state.realizedPnlSol) || 0) + (pnl ?? 0);
  const wins = (Number(state.wins) || 0) + (pnl != null && pnl > 0 ? 1 : 0);
  const losses = (Number(state.losses) || 0) + (pnl != null && pnl < 0 ? 1 : 0);
  const consecutiveLosses = pnl == null
    ? (Number(state.consecutiveLosses) || 0)
    : pnl < 0
      ? (Number(state.consecutiveLosses) || 0) + 1
      : 0;
  const peakWallet = Math.max(Number(state.peakWalletBalanceSol) || 0, walletAfter.balanceSol);
  const riskStop = circuitBreaker({
    currentBalanceSol: walletAfter.balanceSol,
    peakBalanceSol: peakWallet,
    consecutiveLosses,
    maxConsecutiveLosses: Math.max(1, Number(process.env.REAL_MAX_CONSECUTIVE_LOSSES ?? DEFAULT_MAX_CONSECUTIVE_LOSSES)),
    maxDrawdownPct: Math.max(5, Number(process.env.REAL_MAX_DRAWDOWN_PCT ?? DEFAULT_MAX_DRAWDOWN_PCT)),
  });
  const reachedMax = state.entries >= MAX_ENTRIES;
  const preserveManualStop = state.stopReason === "manual";
  const stopReason: StopReason = reachedMax ? "max_entries" : riskStop ?? (preserveManualStop ? "manual" : null);
  const shouldStop = Boolean(stopReason);

  const abandonedMints = args.quarantined
    ? [...new Set([...(state.abandonedMints ?? []), mint])].slice(-50)
    : (state.abandonedMints ?? []);
  const quarantineReason = args.quarantineReason ?? state.lastSellError ?? "no executable exit route";
  const quarantinedPositions = args.quarantined
    ? [
        ...(state.quarantinedPositions ?? []),
        {
          mint,
          name: state.openName ?? null,
          symbol: state.openSymbol ?? null,
          raw: args.remainingRaw ?? state.openTokenAmountRaw ?? null,
          decimals: args.remainingDecimals ?? state.openTokenDecimals ?? null,
          quarantinedAt: Date.now(),
          reason: quarantineReason.slice(0, 300),
        },
      ].slice(-20)
    : (state.quarantinedPositions ?? []);

  const cleared = clearOpenFields(state);
  const next: RealState = {
    ...cleared,
    realizedPnlSol: realized,
    wins,
    losses,
    consecutiveLosses,
    peakWalletBalanceSol: peakWallet,
    lastTradePnlSol: pnl,
    lastTradeReturnPct: tradeRet,
    lastPaperMirrorReturnPct: paperMirrorReturn,
    lastSignalReturnPct: signalReturn,
    lastEntryGapPct: Number.isFinite(entryGap) ? entryGap : null,
    lastExecutionGapPct: executionGap,
    stopped: shouldStop,
    armed: shouldStop ? false : Boolean(state.armed),
    stopReason,
    abandonedMints,
    abandonedCount: (Number(state.abandonedCount) || 0) + (args.quarantined ? 1 : 0),
    lastAbandonedMint: args.quarantined ? mint : state.lastAbandonedMint ?? null,
    quarantinedPositions,
    lastQuarantineReason: args.quarantined ? quarantineReason : state.lastQuarantineReason ?? null,
    lastSignature: args.signature ?? state.lastSignature ?? null,
    lastError: null,
    lastAction: args.quarantined
      ? `QUARANTINE ${mint.slice(0, 6)}… · runner unblocked · REAL ${pnl == null ? "N/D" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(6)} SOL`}`
      : `SELL ${mint.slice(0, 6)}… · REAL ${pnl == null ? "N/D" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(6)} SOL`}${reachedMax ? ` · MAX ${MAX_ENTRIES} COMPLETE` : ""}`,
  };
  await saveState(r, next);
  return { state: next, wallet: walletAfter };
}

async function attemptSell(args: {
  r: Redis;
  state: RealState;
  c: Connection;
  k: Keypair;
  mint: string;
  paperExitMarketCapSol?: number | null;
}) {
  const { r, c, k, mint } = args;
  let state = args.state;
  const now = Date.now();
  const ageMs = Math.max(0, now - Number(state.openOpenedAt || state.sellRetrySince || state.startedAt || now));
  const retry = Number(state.sellRetryCount) || 0;
  const quarantineAfterMs = Math.max(5 * 60_000, Number(process.env.REAL_QUARANTINE_AFTER_MS ?? DEFAULT_QUARANTINE_AFTER_MS));

  let beforeToken: TokenSnapshot;
  try {
    beforeToken = await tokenSnapshotWithRetry(c, k.publicKey, mint, 3, 500);
  } catch (e) {
    const nextRetry = retry + 1;
    const message = `TOKEN_SNAPSHOT_FAILED · ${e instanceof Error ? e.message : "RPC error"}`;
    const shouldQuarantine = (ageMs >= quarantineAfterMs && nextRetry >= 1)
      || shouldQuarantineUnsellablePosition({ ageMs, retryCount: nextRetry, retrySinceMs: state.sellRetrySince, nowMs: now });
    if (shouldQuarantine) {
      return {
        ok: true,
        quarantined: true,
        ...(await finalizeExit({
          r, state, c, k, mint,
          paperExitMarketCapSol: args.paperExitMarketCapSol,
          quarantined: true,
          remainingRaw: state.openTokenAmountRaw ?? null,
          remainingDecimals: state.openTokenDecimals ?? null,
          quarantineReason: message,
        })),
      };
    }
    state = {
      ...state,
      exitRequested: true,
      sellRetryCount: nextRetry,
      sellRetrySince: state.sellRetrySince ?? now,
      lastSellAttemptAt: now,
      lastSellError: message,
      lastAction: `SELL RETRY ${nextRetry} · RPC balance check`,
      lastError: null,
    };
    await saveState(r, state);
    return { ok: false, retry: true, state, error: message };
  }

  // Redis is not the blockchain. If the token is already gone, finalize instead
  // of retrying a ghost position forever.
  if (!rawPositive(beforeToken.raw)) {
    return { ok: true, reconciled: true, ...(await finalizeExit({ r, state, c, k, mint, paperExitMarketCapSol: args.paperExitMarketCapSol })) };
  }

  const baseSlippage = Number(process.env.REAL_SELL_SLIPPAGE_PCT ?? process.env.REAL_SLIPPAGE_PCT ?? DEFAULT_SELL_SLIPPAGE);
  const hasJupiter = Boolean(process.env.JUPITER_API_KEY?.trim());
  const plan = sellPlanForRetry(retry, baseSlippage, hasJupiter);
  let signature: string | null = null;
  let errorMessage: string | null = null;

  try {
    if (plan.engine === "jupiter") {
      signature = await jupiterSell(k, mint, beforeToken.raw);
    } else {
      const tx = await portalTx({
        publicKey: k.publicKey.toBase58(),
        action: "sell",
        mint,
        amount: "100%",
        denominatedInSol: "false",
        slippagePct: plan.slippagePct,
        pool: plan.pool,
      });
      signature = (await signAndSendVersioned(c, k, tx, { simulate: true })).sig;
    }
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : "SELL failed";
    const sent = errorMessage.match(/SENT_SIG=([1-9A-HJ-NP-Za-km-z]+)/)?.[1];
    if (sent) signature = sent;

    // Pump's 6024/0x1788 Overflow is not a normal slippage miss. Repeating the
    // same Pump instruction can loop forever. If Jupiter is configured, try the
    // genuinely independent route immediately in the SAME recovery request.
    // Otherwise the balance reconciliation below decides whether a stale bag
    // must be quarantined; we never pretend it sold.
    const pumpOverflow = /\b6024\b|0x1788|Error Code:\s*Overflow|Error Message:\s*Overflow|\bOverflow\b/i.test(errorMessage);
    if (pumpOverflow && plan.engine !== "jupiter" && hasJupiter && !signature) {
      try {
        signature = await jupiterSell(k, mint, beforeToken.raw);
        errorMessage = null;
      } catch (jupiterError) {
        errorMessage = `PUMP_OVERFLOW_6024 · Jupiter fallback failed: ${jupiterError instanceof Error ? jupiterError.message : "error"}`;
      }
    }
  }

  // A transaction can land after confirmation times out. Poll the actual token
  // balance for a few seconds before declaring another retry.
  let afterToken: TokenSnapshot = beforeToken;
  try {
    afterToken = await waitForTokenChange({
      c,
      owner: k.publicKey,
      mint,
      beforeRaw: beforeToken.raw,
      direction: "zero",
      timeoutMs: signature ? 7_000 : 2_500,
    });
  } catch (e) {
    errorMessage = `${errorMessage ?? "SELL sent"} · post-sell balance check failed: ${e instanceof Error ? e.message : "RPC error"}`;
  }

  if (!rawPositive(afterToken.raw)) {
    return {
      ok: true,
      reconciled: true,
      ...(await finalizeExit({ r, state, c, k, mint, signature, paperExitMarketCapSol: args.paperExitMarketCapSol })),
    };
  }

  const nextRetry = retry + 1;
  const overflowStillPresent = /\b6024\b|0x1788|PUMP_OVERFLOW_6024|Error Code:\s*Overflow|Error Message:\s*Overflow|\bOverflow\b/i.test(errorMessage ?? "");
  const shouldQuarantine = overflowStillPresent
    // A confirmed on-chain balance + Pump arithmetic overflow after an exit
    // request is an execution-route failure, not a reason to monopolize the
    // single REAL slot indefinitely. Quarantine preserves the token in the audit
    // trail/blacklist and conservatively counts the spent SOL as lost.
    || (ageMs >= quarantineAfterMs && nextRetry >= 1)
    || shouldQuarantineUnsellablePosition({
      ageMs,
      retryCount: nextRetry,
      retrySinceMs: state.sellRetrySince ?? now,
      nowMs: Date.now(),
    });

  if (shouldQuarantine) {
    return {
      ok: true,
      quarantined: true,
      ...(await finalizeExit({
        r, state, c, k, mint, signature,
        paperExitMarketCapSol: args.paperExitMarketCapSol,
        quarantined: true,
        remainingRaw: afterToken.raw,
        remainingDecimals: afterToken.decimals,
        quarantineReason: errorMessage ?? `No executable exit after ${nextRetry} attempts; token balance remains ${afterToken.raw}`,
      })),
    };
  }

  state = {
    ...state,
    exitRequested: true,
    sellRetryCount: nextRetry,
    sellRetrySince: state.sellRetrySince ?? now,
    lastSellAttemptAt: Date.now(),
    lastSellError: errorMessage ?? `Token balance remains ${afterToken.raw}`,
    lastAction: `SELL RETRY ${nextRetry} · ${plan.engine}${plan.pool ? `/${plan.pool}` : ""} · ${plan.slippagePct}%`,
    lastError: null,
  };
  await saveState(r, state);
  return { ok: false, retry: true, state, token: afterToken, error: state.lastSellError };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  try {
    const r = redisClient();
    const k = parseKeypair();
    const c = new Connection(rpcUrl(), "confirmed");
    const state = await getState(r);
    const wallet = await walletSnapshot(c, k);
    let chainPosition: TokenSnapshot | null = null;
    let chainPositionError: string | null = null;
    if (state.openMint) {
      try {
        chainPosition = await tokenSnapshotWithRetry(c, k.publicKey, state.openMint, 2, 300);
      } catch (e) {
        chainPositionError = e instanceof Error ? e.message : "token balance unavailable";
      }
    }
    return NextResponse.json({
      ok: true,
      state,
      wallet,
      chainPosition,
      chainPositionError,
      maxEntries: MAX_ENTRIES,
      buyFraction: Number(process.env.REAL_BUY_FRACTION ?? DEFAULT_BUY_FRACTION),
      reserveSol: Number(process.env.REAL_RESERVE_SOL ?? DEFAULT_RESERVE_SOL),
      stalePositionMs: Number(process.env.REAL_STALE_POSITION_MS ?? DEFAULT_STALE_POSITION_MS),
      quarantineAfterMs: Number(process.env.REAL_QUARANTINE_AFTER_MS ?? DEFAULT_QUARANTINE_AFTER_MS),
      jupiterFallback: Boolean(process.env.JUPITER_API_KEY?.trim()),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  const mint = String(body?.mint ?? "");
  const r = redisClient();

  try {
    let state = await getState(r);

    if (action === "reset") {
      if (state.openMint) return NextResponse.json({ ok: false, error: "No se puede resetear mientras exista una posición real abierta." }, { status: 409 });
      const next = emptyState();
      await saveState(r, next);
      return NextResponse.json({ ok: true, state: next });
    }

    if (action === "arm") {
      if (state.openMint) return NextResponse.json({ ok: false, error: "Primero debe cerrarse/reconciliarse la posición real abierta." }, { status: 409 });
      if (state.entries >= MAX_ENTRIES) return NextResponse.json({ ok: false, error: `Máximo de ${MAX_ENTRIES} entradas alcanzado.` }, { status: 409 });
      if (state.stopReason === "loss_streak" || state.stopReason === "drawdown") {
        return NextResponse.json({ ok: false, error: `Circuit breaker activo: ${state.stopReason}. Reset explícito requerido antes de arriesgar más capital.` }, { status: 409 });
      }
      const next: RealState = { ...state, stopped: false, stopReason: null, armed: true, lastAction: "REAL TEST ARMED", lastError: null };
      await saveState(r, next);
      return NextResponse.json({ ok: true, state: next });
    }

    if (action === "disarm") {
      const next = { ...state, armed: false, lastAction: "REAL TEST DISARMED" };
      await saveState(r, next);
      return NextResponse.json({ ok: true, state: next });
    }

    if (action === "stop") {
      const next: RealState = { ...state, stopped: true, armed: false, stopReason: "manual", lastAction: "KILL SWITCH" };
      await saveState(r, next);
      return NextResponse.json({ ok: true, state: next });
    }

    if ((action === "buy" || action === "sell") && (!mint || mint.length < 30)) {
      return NextResponse.json({ ok: false, error: "Mint inválido" }, { status: 400 });
    }

    const lock = await acquireTradeLock(r);
    if (!lock) return NextResponse.json({ ok: false, retry: true, error: "TRADE_BUSY" }, { status: 409 });

    try {
      // Re-read AFTER acquiring the lock. This closes the multi-tab/server race that
      // could otherwise create two positions from the same stale Redis snapshot.
      state = await getState(r);
      const k = parseKeypair();
      const c = new Connection(rpcUrl(), "confirmed");
      const wallet = await walletSnapshot(c, k);

      if (action === "buy") {
        if (state.stopped || !state.armed) return NextResponse.json({ ok: false, error: "REAL TEST no está armado para nuevas compras." }, { status: 409 });
        if (state.entries >= MAX_ENTRIES) return NextResponse.json({ ok: false, error: `Máximo de ${MAX_ENTRIES} entradas alcanzado.` }, { status: 409 });
        if (state.openMint) return NextResponse.json({ ok: false, error: "Ya existe una posición real abierta." }, { status: 409 });
        if ((state.abandonedMints ?? []).includes(mint)) {
          const skipped = { ...state, skippedBuys: (Number(state.skippedBuys) || 0) + 1, lastSkipReason: "blacklisted unsellable mint", lastAction: `SKIP ${mint.slice(0, 6)}… · blacklist` };
          await saveState(r, skipped);
          return NextResponse.json({ ok: false, skip: true, error: "SKIP_TOKEN", reason: "blacklisted unsellable mint", state: skipped }, { status: 422 });
        }

        const reserve = Number(process.env.REAL_RESERVE_SOL ?? DEFAULT_RESERVE_SOL);
        const fraction = Math.min(0.5, Math.max(0.05, Number(process.env.REAL_BUY_FRACTION ?? DEFAULT_BUY_FRACTION)));
        const amountSol = Math.min(Math.max(0, wallet.balanceSol - reserve), wallet.balanceSol * fraction);
        if (amountSol <= 0.0005) {
          const next: RealState = { ...state, stopped: true, armed: false, stopReason: "insufficient_balance", lastAction: "INSUFFICIENT BALANCE", lastError: "Saldo insuficiente para otra entrada + fees." };
          await saveState(r, next);
          return NextResponse.json({ ok: false, error: next.lastError, state: next }, { status: 409 });
        }

        try {
          await preBuyMintGuard(c, mint);
        } catch (e) {
          const message = e instanceof Error ? e.message : "PREBUY_SKIP mint guard";
          const skipped = {
            ...state,
            skippedBuys: (Number(state.skippedBuys) || 0) + 1,
            lastSkipReason: message.slice(0, 300),
            lastAction: `SKIP ${mint.slice(0, 6)}… · mint guard`,
            lastError: null,
          };
          await saveState(r, skipped);
          return NextResponse.json({ ok: false, skip: true, error: "SKIP_TOKEN", reason: message, state: skipped }, { status: 422 });
        }

        const tokenBefore = await tokenSnapshotWithRetry(c, k.publicKey, mint, 3, 350);
        let sentSig: string | null = null;
        let estimatedExecutionCostSol = 0;
        let sendError: string | null = null;
        try {
          const tx = await portalTx({ publicKey: wallet.publicKey, action: "buy", mint, amount: amountSol, denominatedInSol: "true", pool: "auto" });
          const sent = await signAndSendVersioned(c, k, tx, { buyAmountSol: amountSol, simulate: true });
          sentSig = sent.sig;
          estimatedExecutionCostSol = sent.estimatedExecutionCostSol;
        } catch (e) {
          sendError = e instanceof Error ? e.message : "BUY failed";
          sentSig = sendError.match(/SENT_SIG=([1-9A-HJ-NP-Za-km-z]+)/)?.[1] ?? null;
          // If nothing was broadcast, runaway/slippage/preflight errors are clean
          // skips. If a signature exists, first reconcile the actual token balance:
          // confirmation timeouts are not proof that the BUY failed.
          if (!sentSig && classifyBuyError(sendError) === "skip") {
            const skipped = {
              ...state,
              skippedBuys: (Number(state.skippedBuys) || 0) + 1,
              lastSkipReason: sendError.slice(0, 300),
              lastAction: `SKIP ${mint.slice(0, 6)}… · execution/preflight`,
              lastError: null,
            };
            await saveState(r, skipped);
            return NextResponse.json({ ok: false, skip: true, error: "SKIP_TOKEN", reason: sendError, state: skipped }, { status: 422 });
          }
          if (!sentSig && classifyBuyError(sendError) === "fatal") throw e;
        }

        const tokenAfter = await waitForTokenChange({
          c,
          owner: k.publicKey,
          mint,
          beforeRaw: tokenBefore.raw,
          direction: "increase",
          timeoutMs: sentSig ? 8_000 : 3_000,
        });
        let acquiredRaw = BigInt(0);
        try { acquiredRaw = BigInt(tokenAfter.raw) - BigInt(tokenBefore.raw); } catch {}
        if (acquiredRaw <= BigInt(0)) {
          if (sendError && classifyBuyError(sendError) === "skip") {
            const skipped = {
              ...state,
              skippedBuys: (Number(state.skippedBuys) || 0) + 1,
              lastSkipReason: `${sendError} · no token delta after reconciliation`.slice(0, 300),
              lastAction: `SKIP ${mint.slice(0, 6)}… · no confirmed fill`,
              lastError: null,
            };
            await saveState(r, skipped);
            return NextResponse.json({ ok: false, skip: true, error: "SKIP_TOKEN", reason: skipped.lastSkipReason, state: skipped }, { status: 422 });
          }
          throw new Error(`BUY ${sentSig ?? "without signature"} did not produce a confirmed token balance increase.`);
        }

        const walletAfterBuy = await walletSnapshot(c, k);
        const signalMc = Number(body?.entryMarketCapSol);
        const effectiveFillMc = await effectiveFillMarketCapSol(c, mint, amountSol, acquiredRaw.toString());
        const entryMc = effectiveFillMc ?? (Number.isFinite(signalMc) && signalMc > 0 ? signalMc : null);
        const entryGapPct = entryMc && signalMc > 0 ? ((entryMc / signalMc) - 1) * 100 : null;
        const nextEntries = state.entries + 1;
        const next: RealState = {
          ...state,
          entries: nextEntries,
          openMint: mint,
          armed: nextEntries < MAX_ENTRIES,
          stopped: false,
          stopReason: null,
          openEntryMarketCapSol: entryMc,
          openSignalMarketCapSol: Number.isFinite(signalMc) && signalMc > 0 ? signalMc : null,
          openEntryGapPct: entryGapPct,
          openName: typeof body?.name === "string" ? body.name : null,
          openSymbol: typeof body?.symbol === "string" ? body.symbol : null,
          openOpenedAt: Date.now(),
          openBalanceBeforeBuySol: wallet.balanceSol,
          openBalanceAfterBuySol: walletAfterBuy.balanceSol,
          openTokenAmountRaw: acquiredRaw.toString(),
          openTokenDecimals: tokenAfter.decimals,
          exitRequested: false,
          sellRetryCount: 0,
          sellRetrySince: null,
          lastSellAttemptAt: null,
          lastSellError: null,
          peakWalletBalanceSol: Number(state.peakWalletBalanceSol) > 0 ? state.peakWalletBalanceSol : wallet.balanceSol,
          lastAction: `BUY ${mint.slice(0, 6)}… ${amountSol.toFixed(6)} SOL · fill ${entryMc ? `${entryMc.toFixed(2)} MC SOL` : "MC N/D"}`,
          lastSignature: sentSig,
          lastError: null,
          startedAt: state.startedAt ?? Date.now(),
        };
        const maxEntryGapPct = Math.max(2, Number(process.env.REAL_MAX_ENTRY_GAP_PCT ?? DEFAULT_MAX_ENTRY_GAP_PCT));
        if (entryGapPct != null && entryGapPct > maxEntryGapPct) {
          // The BUY did land, so this is NOT a skipped token. Immediately request
          // an autonomous exit when the real fill was far worse than the signal.
          const chased: RealState = {
            ...next,
            exitRequested: true,
            sellRetrySince: Date.now(),
            lastAction: `BUY ${mint.slice(0, 6)}… · entry gap ${entryGapPct.toFixed(1)}% > ${maxEntryGapPct.toFixed(1)}% · AUTO EXIT`,
          };
          await saveState(r, chased);
          const exit = await attemptSell({
            r, state: chased, c, k, mint,
            paperExitMarketCapSol: Number(body?.entryMarketCapSol) || null,
          });
          return NextResponse.json({
            ...exit,
            ok: true,
            autoExit: true,
            warning: "ENTRY_GAP_AUTO_EXIT",
            signature: sentSig,
            amountSol,
            estimatedExecutionCostSol,
            effectiveFillMarketCapSol: entryMc,
            entryGapPct,
          });
        }

        await saveState(r, next);
        return NextResponse.json({
          ok: true,
          state: next,
          signature: sentSig,
          amountSol,
          estimatedExecutionCostSol,
          effectiveFillMarketCapSol: entryMc,
          entryGapPct,
          wallet: walletAfterBuy,
          token: tokenAfter,
        });
      }

      if (action === "sell") {
        if (state.openMint !== mint) return NextResponse.json({ ok: false, error: "Ese mint no es la posición real abierta." }, { status: 409 });
        state = {
          ...state,
          exitRequested: true,
          sellRetrySince: state.sellRetrySince ?? Date.now(),
          lastSellAttemptAt: Date.now(),
        };
        await saveState(r, state);
        const result = await attemptSell({ r, state, c, k, mint, paperExitMarketCapSol: Number(body?.paperExitMarketCapSol) || null });
        return NextResponse.json(result, { status: result.ok ? 200 : 503 });
      }

      if (action === "reconcile") {
        if (!state.openMint) return NextResponse.json({ ok: true, state, wallet });
        const openMint = state.openMint;
        let token: TokenSnapshot | null = null;
        try { token = await tokenSnapshotWithRetry(c, k.publicKey, openMint, 2, 300); } catch {}
        if (token && !rawPositive(token.raw)) {
          const result = await finalizeExit({ r, state, c, k, mint: openMint, paperExitMarketCapSol: Number(body?.paperExitMarketCapSol) || null });
          return NextResponse.json({ ok: true, reconciled: true, ...result });
        }
        const ageMs = Math.max(0, Date.now() - Number(state.openOpenedAt || state.sellRetrySince || state.startedAt || Date.now()));
        const staleMs = Math.max(30_000, Number(process.env.REAL_STALE_POSITION_MS ?? DEFAULT_STALE_POSITION_MS));
        if (!state.exitRequested && ageMs < staleMs && token) {
          return NextResponse.json({ ok: true, state, wallet, token, monitoring: true });
        }
        // Stale positions, explicit exit requests, and RPC-uncertain positions all
        // flow through the same bounded autonomous recovery. This is what unblocks
        // legacy HAVOC-like states without a manual button.
        const result = await attemptSell({ r, state: { ...state, exitRequested: true }, c, k, mint: openMint, paperExitMarketCapSol: Number(body?.paperExitMarketCapSol) || null });
        return NextResponse.json(result, { status: result.ok ? 200 : 503 });
      }

      return NextResponse.json({ ok: false, error: "Acción inválida" }, { status: 400 });
    } finally {
      await releaseTradeLock(r, lock);
    }
  } catch (e) {
    try {
      const s = await getState(r);
      await saveState(r, { ...s, lastError: e instanceof Error ? e.message : "Error desconocido" });
    } catch {}
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Error desconocido" }, { status: 500 });
  }
}
