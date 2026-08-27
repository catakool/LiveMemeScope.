# MemeScope V26.2 — Entry Pipeline Fix

Root cause fixed:
V26.1 allowed REAL entry only within 12 seconds of token creation. When DexScreener
was the price fallback, indexing commonly started after that window. PAPER could
track the token, while REAL silently rejected every candidate before the backend,
leaving entries and skips unchanged.

Changes:
- PumpDev/live trade mode: short 15s birth-age entry window.
- Dex fallback: up to 45s measured from first usable observed quote.
- Momentum floor reduced from 0.6% to 0.35%, while preserving multiple observations,
  positive recent movement, reversal protection and buy-pressure checks when trade
  side information exists.
- Visible Entry engine telemetry: TRACK / PASS / QUALIFIED / SKIP / FILLED.
- Evaluation and qualification counters.
- No change to 20% position sizing env setting, 20-entry cap, one-position limit,
  circuit breakers, SELL recovery, quarantine, or Jupiter fallback.
