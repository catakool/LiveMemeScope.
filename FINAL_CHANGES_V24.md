# MemeScope V24 — REAL EDGE

- No blind real BUY at token creation.
- Waits for short confirmed momentum before allowing a real entry.
- Economic preflight simulates the signed transaction before broadcast.
- Skips runaway/slippage simulation failures instead of chasing the token.
- Rejects excessive estimated execution cost (configurable with REAL_MAX_BUY_COST_PCT; default 5%).
- Separate BUY/SELL slippage defaults: BUY 6%, SELL 12% (environment overrides supported).
- Autonomous SELL and retry behavior preserved.
- Real position is always shown in the panel while open.
- Tracks realized real PnL and W/L.
- Records Paper-mirror return vs real net return and the execution gap after exits.
- Existing Redis state key, one-position rule, and 20-entry cap preserved.
- Position size remains controlled by REAL_BUY_FRACTION (your Vercel value wins).

Note: I performed static/source checks and ZIP integrity checks here. A full npm install/build could not be completed in this execution environment, so Vercel remains the authoritative build check.
