# MemeScope V26 — REAL CORE / HAVOC FIX

This release is built from the exact LiveMemeScope repository ZIP supplied by the user.
It is a reliability rebuild of the real-money runner, not a promise of profitability.

## HAVOC / stuck-position recovery
- Redis is reconciled against the actual on-chain token balance.
- A stale open position gets a fresh real exit attempt using current routes.
- SELL confirmation timeouts are reconciled by token balance before retrying.
- Token-balance RPC failures increment bounded recovery state instead of freezing forever.
- If a token remains genuinely unsellable after the bounded stale/retry policy, it is moved to **QUARANTINE**: the mint is blacklisted, the active real slot is released, and the remaining token balance is kept explicitly in audit state. Quarantine never claims that the token was sold.
- A manual Kill Switch remains respected; recovery never silently re-arms a manually stopped bot.

## REAL execution is anchored to the actual fill
- BUY records the token balance before and after execution.
- Effective real entry market cap is derived from SOL actually spent, tokens actually acquired, and token supply when available.
- The original PAPER/signal entry is stored separately.
- UI reports signal return, entry gap, fill-mirror return, real net return and execution gap.
- If the actual fill is more than `REAL_MAX_ENTRY_GAP_PCT` worse than the signal (default 12%), the bot immediately requests an autonomous exit rather than pretending it got the PAPER price.

## BUY hardening
- Redis execution lock expanded to 90 seconds.
- Mint guard rejects unsupported token programs and active freeze authority before spending real SOL.
- BUY errors known to be transient/non-executable (slippage, 6002, 6024/overflow, stale blockhash, etc.) are skips rather than fatal bot stops.
- A transaction that was sent but timed out is reconciled by actual token balance so a landed BUY cannot become an untracked bag.
- REAL entry confirmation is earlier but tighter: it avoids blind creation buys and avoids chasing already-extended launches.

## SELL hardening
- Every REAL mirror exit path uses the same real exit request/recovery flow, including price fallback monitoring.
- Dynamic trailing no longer requires buy/sell-side metadata, so DexScreener fallback can trigger the same reversal protection.
- A single severe post-fill REAL quote can trigger the hard stop without waiting for PAPER statistical-validity ticks.
- PumpPortal retry plan rotates supported pools and progressively increases SELL tolerance.
- Optional Jupiter Swap V2 fallback is used periodically when `JUPITER_API_KEY` is configured.
- Empty token accounts are closed after a confirmed exit when possible to recover rent.

## Capital protection / accounting
- Existing 20-entry cap and environment-configured `REAL_BUY_FRACTION` are preserved (the user's current 0.20 setting continues to apply).
- Existing consecutive-loss and drawdown circuit breakers remain active.
- REAL PnL remains based on wallet SOL delta across BUY -> SELL, including transaction costs.
- Quarantined/unsellable positions are treated conservatively in realized accounting rather than shown as successful exits.
- PAPER audit removes at least the single best trade when showing trimmed-outlier PnL, even with fewer than 20 valid trades.

## State compatibility
- Redis state key remains `memescope:real-test:v22` intentionally so the live 5/20 or 6/20 counter and any stuck position are recovered rather than forgotten during deploy.
- Old `abandoned*` fields remain readable for backward compatibility, but new stuck positions are recorded transparently under `quarantinedPositions`.

## Optional environment variables
- `REAL_MAX_ENTRY_GAP_PCT=12`
- `REAL_QUARANTINE_AFTER_MS=900000`
- `JUPITER_API_KEY=...` for optional Jupiter fallback

No wallet private key is exposed to the browser. Existing `REAL_WALLET_PRIVATE_KEY` remains server-side only.
