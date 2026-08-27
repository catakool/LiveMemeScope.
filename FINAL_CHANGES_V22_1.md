# MemeScope V22.1 — Real Runner Recovery Fix

## What actually caused the stop
The V22 browser WebSocket captured a stale `realBusy` React value. Two token-create
events arriving almost together could fire two real BUY requests. The backend
correctly rejected the second because one position was already open, but the
frontend interpreted that 409 as a fatal error and disarmed REAL TEST.

## Fixes
- Synchronous `realBusyRef` prevents overlapping BUY requests.
- ARMED state is now persisted in Redis and restored after refresh/status check.
- Future BUYs persist entry market cap, token name/symbol and open time in Redis.
- An open real position can be reconstructed after a browser refresh and the
  trade stream is re-subscribed automatically.
- Existing/legacy V22 positions without a persisted entry price are NOT guessed;
  they expose `SELL OPEN POSITION NOW` for safe recovery.
- KILL SWITCH blocks new BUYs but SELL remains allowed.
- Reset is blocked while a real position is open.
- The 20th BUY can still SELL; the test stops only after that final position exits.
- `SELL OPEN POSITION NOW` sells 100% of the Redis-tracked open mint.
- Priority fee remains 0.00005 SOL by default. Solscan notation such as 0.₄5 SOL
  represents leading zeroes; it is not 0.05 SOL.

The Redis state key remains `memescope:real-test:v22`, so the user's existing
5/20 counter and currently open mint are preserved through this upgrade.
