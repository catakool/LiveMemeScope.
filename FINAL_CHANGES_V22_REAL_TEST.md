# MemeScope V22 — REAL TEST

## Hard limits
- 20 real BUY entries maximum.
- 1 real position at a time.
- No auto-top-up or access to any other wallet.
- Uses only the balance already present in the dedicated hot wallet.
- Default BUY size: 25% of current SOL balance, leaving a fee reserve.
- If balance becomes too small: STOP.
- At entry 20: STOP.
- Any execution error: browser disarms new entries (fail-closed).
- KILL SWITCH in UI.

## Execution
- PumpPortal Local Transaction API builds the transaction.
- The transaction is signed server-side by the dedicated test wallet.
- Solana preflight is enabled.
- SELL uses 100% of the open token position.
- Real entry/exit mirrors the Paper Sniper signal while REAL TEST is armed.
- The browser tab must remain open: the launch/trade stream currently runs in the browser.

## Required Vercel Environment Variables
- REAL_WALLET_PRIVATE_KEY = private key of the dedicated test wallet ONLY
- REAL_CONTROL_TOKEN = a long random password used by the browser to authorize the REAL TEST API
- SOLANA_RPC_URL = recommended dedicated Solana RPC
- KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH equivalents) = required to persist/enforce the 20-entry counter

Optional:
- REAL_BUY_FRACTION = default 0.25, hard-capped by code to 0.50
- REAL_RESERVE_SOL = default 0.003
- REAL_SLIPPAGE_PCT = default 10
- REAL_PRIORITY_FEE_SOL = default 0.00005

Never commit any private key or REAL_CONTROL_TOKEN to GitHub.
