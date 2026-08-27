# MemeScope V23.2 — Autonomous Exit Fix

## Goal
The user should not have to decide when to sell or notice that an exit became stuck.

## Changes
- Legacy/orphan real position with no persisted entry reference:
  automatically attempts to SELL 100% instead of asking for a manual decision.
- Failed SELL:
  pauses new BUYs and retries the same SELL automatically every ~4 seconds.
- Successful SELL:
  clears retry state and normal flow resumes according to server ARMED/STOP state.
- BUY rejected by Pump.fun/PumpPortal because price/slippage ran away
  (`TooMuchSolRequired`, 6002, 0x1772):
  skips that token and stays ARMED for the next opportunity.
- Unknown BUY errors still fail closed.
- Emergency Sell remains only as a backup control.
- Existing Redis state/key and the 20-entry cap are preserved.
- No increase to position sizing or allowed trade count.

Important: the browser tab still hosts the real-time launch/trade monitor in this architecture,
so it must remain open for autonomous signal monitoring/retry.
