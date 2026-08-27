# MemeScope V21 — Execution Audit

Paper-only audit layer added before any real-money integration.

Metrics:
- valid trades
- median return per trade
- profit factor
- maximum drawdown in USD
- best/worst trade
- PnL excluding the top 1% of winning trades
- best trade contribution to total PnL
- entry/exit market-cap values and quote count in exit history

Uses a new localStorage key so the audit starts with a clean dataset.
No wallet, private key, Solflare, or real execution was added.
