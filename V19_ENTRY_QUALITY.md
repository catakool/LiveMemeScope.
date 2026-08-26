# MemeScope v19 — ENTRY QUALITY

Goal: reduce late/chasing entries instead of adding another discovery gimmick.

Changes from v18:
- Live early-discovery liquidity floor raised from $10k to $20k.
- Early activity floor raised to 15 tx/5m and $2k volume/5m.
- Emerging now requires score >=65, liquidity >=$25k, >=20 tx/5m, +2% to +25% 5m, and no high/critical activity-inflation risk.
- Breakout now requires score >=72, liquidity >=$30k, >=25 tx/5m, +4% to +35% 5m, and no high/critical activity-inflation risk.
- Explosive requires stronger liquidity/quality and rejects >45% 5m moves as fresh entries.
- New Entry Quality score ranks live candidates by tradability rather than raw momentum.
- Entry Quality penalizes vertical 5m moves, thin liquidity, extreme buy ratios, very young pairs, promoted/boosted discovery, activity inflation and high/critical security risk.
- Default UI sorting is Entry Quality. Raw Early Momentum remains available as a secondary sort.
- Continuation backtest, Security, Trading Lab and Catalyst Intelligence are retained.

This is a heuristic research tool, not a guarantee of profitability.
