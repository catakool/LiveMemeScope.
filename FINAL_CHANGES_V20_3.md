# MemeScope V20.3 — Strict Paper Data Validation

## Bug corregido
V20.2 podía recibir una sola cotización plana/estancada, activar `NO MOMENTUM`
y convertir un 0% bruto en -3% por la fricción simulada. Eso generaba series
artificiales de operaciones exactamente en -3%.

## Nueva regla de validez
Una paper trade NO entra en estadísticas hasta tener:
- al menos 3 observaciones posteriores a la entrada;
- al menos 2 niveles de precio realmente distintos;
- al menos 1.5 segundos entre observaciones.

Si no cumple las tres:
WAIT -> NO DATA -> PnL 0 -> no afecta win rate ni PnL.

## Cierres
Hard stop, reversal, sell pressure y no-momentum no pueden cerrar una operación
como válida antes de establecer una serie de mercado válida.
La fricción del 3% solo se aplica a resultados válidos.

## Historial
- Storage key nueva `v20.3`, así que el histórico falso anterior no se hereda.
- Botón `Reset paper` para borrar manualmente el paper history actual.
- NO DATA aparece como N/D, no como +0%.

No hay conexión con Solflare ni ejecución de dinero real.
