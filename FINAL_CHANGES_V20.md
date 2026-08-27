# MemeScope V20 — Auto Paper Sniper

- Auto Paper Sniper 100% virtual; no wallet, no Solflare, no firma de transacciones.
- Usa el mismo WebSocket de nuevos lanzamientos y se suscribe al trade stream de hasta 5 tokens simultáneamente (límite anónimo del proveedor).
- Entrada virtual de $10 al nacimiento cuando existe marketCapSol utilizable.
- Sigue cada buy/sell y usa market cap SOL como proxy relativo de precio.
- Salidas virtuales dinámicas:
  - hard stop -12%;
  - trailing/reversal ~6–12% desde el máximo, adaptado al tamaño del pump;
  - sell pressure;
  - no momentum a los 30s;
  - time exit a los 90s;
  - cierre manual de paper.
- PnL neto descuenta 3% de fricción estimada como aproximación conservadora; no pretende reproducir slippage real.
- Dashboard en Launch Radar: abiertas, cerradas, win rate, PnL virtual, peak, drawdown desde peak, buys/sells y motivo de salida.
- Historial local persistido en localStorage (hasta 120 registros).
- COPY MINT añadido a cada token del Direct Launch Stream.
- El bot solo funciona mientras la pestaña Launch Radar está abierta. No existe ejecución real en V20.
