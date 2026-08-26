# MemeScope V19 — Launch Radar / First 5 Minutes

- Launch Radar is now the default/home view.
- Focuses only on Solana pairs aged 0–5 minutes.
- Three simple windows: <1m, 1–2m, 2–5m.
- New experimental Launch Velocity score based on activity/minute, volume/minute, buy pressure, liquidity and early price movement.
- First-five-minute candidates no longer need to pass the old confirmed-momentum gates; minimal anti-noise gates remain ($3k liquidity, 2 trades, $100 volume).
- UI refreshes every 15 seconds; radar cache reduced to 12 seconds.
- Security critical and critical activity inflation remain blockers/warnings.
- Main UI reduced to Launch Radar, Trading Lab, Advanced. Old Continuation/Catalyst/CoinGecko detail is kept under Advanced rather than cluttering the main screen.
- Manual “I bought” monitoring remains available directly on launch cards.
- Honest limitation shown in UI: DexScreener public API does not guarantee a complete stream of every newly-created pair.
