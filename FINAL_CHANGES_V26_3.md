# MemeScope V26.3 — ACTIVE FLOW

Objetivo: sair do estado visual/operacional de estagnação sem remover proteções duras.

- Live entry window: 25s. Dex fallback: 60s from first usable quote.
- Minimum total momentum: 0.15%; minimum recent move: 0.10%.
- Live buy pressure threshold: 54%; at least one observed buy.
- Max tolerated pullback before entry: -6%.
- The same rejected mint is not sent repeatedly to preflight during the browser session.
- Visible throughput telemetry: eval / pass / qualified / preflight / filled + last skip reason.
- Still preserved: SPL-token/freeze mint guard, transaction simulation, max execution-cost guard, Redis trade lock, one real position, 20-entry cap, circuit breakers, on-chain reconciliation, Jupiter SELL fallback and quarantine.

This increases opportunity throughput; it does not guarantee profitability.
