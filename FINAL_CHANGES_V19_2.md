# MemeScope v19.2 — Launch Radar: show first, score second

- Eliminados los gates mínimos de $3k de liquidez, 2 trades y $100 de volumen para pares <=5 min.
- Todo par Solana <=5 min CONFIRMADO por DexScreener que MemeScope descubra aparece en Launch Radar.
- Launch Velocity/seguridad ya no determinan si el token aparece; ordenan/alertan.
- Estados simples: NEW / WARMING UP / ACCELERATING / LAUNCHING / DANGER.
- Añadido descubrimiento suplementario desde la página New de Pump.fun.
- Un mint Pump.fun nunca se muestra por sí solo: DexScreener debe confirmar un pairCreatedAt real.
- El header muestra cuántos seeds fueron escaneados para diagnosticar discovery.
- Cache key nueva para no reutilizar un feed vacío de V19/V19.1.
