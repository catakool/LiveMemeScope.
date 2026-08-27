# MemeScope V23.1 — Build Fix

Fixes Vercel TypeScript errors in `src/app/api/real-test/route.ts`.

The wallet snapshot shape is:
- `publicKey`
- `balanceSol`

V23 mistakenly referenced `.sol` in three real-PnL calculations.
All three now use `.balanceSol`.

No trading limits, wallet settings, Redis state keys, entry counter,
position sizing, or execution behavior were changed.
