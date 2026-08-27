# MemeScope V20.1 — Stream Reliability Fix

- Direct Launch Stream no depende de un único proveedor.
- Intenta PumpDev primero; si falla/timeout, prueba PumpPortal para `subscribeNewToken`.
- Estado visible: proveedor activo + último error de conexión.
- PumpPortal se usa solo para lanzamientos; no fingimos que sus trades son gratis/sin key.
- Si PumpDev trade-stream no está disponible, Auto Paper Sniper monitoriza las posiciones abiertas vía DexScreener cada ~2.5s.
- En fallback se conservan trailing, hard stop, reversión/no-momentum y time exit; `sell pressure` solo se usa cuando hay trades reales.
- Nunca conecta wallet ni mueve SOL.
