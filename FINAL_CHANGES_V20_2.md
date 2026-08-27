# MemeScope V20.2 — Honest Paper Sniper Fix

- El -3% de fricción ya no aparece al abrir; se descuenta únicamente al cerrar un resultado válido.
- Las posiciones sin observaciones posteriores reales se marcan NO DATA y quedan fuera de win rate/PnL.
- El primer quote DexScreener es solo un anchor y no cuenta como movimiento real.
- Cuando Launch Stream usa PumpPortal, MemeScope reintenta PumpDev en segundo plano para recuperar buy/sell trades en tiempo real.
- Si PumpDev sigue indisponible, DexScreener continúa como fallback de precio.
- UI muestra WAIT mientras no existe precio posterior real y separa NO DATA de operaciones cerradas válidas.
