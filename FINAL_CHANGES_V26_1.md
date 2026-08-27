# V26.1 — Pump 6024 Overflow Exit Fix

- Detects Pump SELL `Overflow` / `6024` / `0x1788` explicitly.
- If `JUPITER_API_KEY` exists, an independent Jupiter SELL is attempted immediately in the same request.
- If the token balance remains on-chain and Pump still returns arithmetic overflow, the position is quarantined immediately instead of entering an endless SELL RETRY loop.
- Quarantine does **not** claim the token was sold: the mint remains in the quarantine audit/blacklist and the active REAL slot is released.
- On-chain zero balance still reconciles as a normal successful close.
- No changes to private-key handling, 20-entry cap, 20% env-controlled position sizing, or Redis state key.
