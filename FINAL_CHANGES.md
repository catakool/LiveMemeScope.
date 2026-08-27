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


# MemeScope v18 — Catalyst Intelligence

- Catalyst Score 0–100 separado de Momentum, Continuation e Security.
- Narrativa e evidências clicáveis.
- Zero-cost por defeito via metadata/socials/websites/boosts/community takeovers da DexScreener.
- NEWS_API_KEY opcional para notícias recentes; sem chave a app continua normalmente.
- Reddit fica disabled nesta versão: não fazemos scraping frágil; fica preparado para integração autorizada futura.
- Só os 8 candidatos live mais fortes são enriquecidos, com cache de 10 min.

# MemeScope v17 — Trading Lab

- Paper Trading automático de $10 em Breakout/Explosive que passem gates mínimos.
- Regras experimentais: TP +20%, SL -15%, momentum expired, security critical e time exit 20m.
- Resultados PAPER descontam 1,5% de fricção estimada de round-trip (slippage/fees) para serem menos otimistas.
- Position/Exit Monitor para entradas reais marcadas com `💰 Marquei compra`; não executa vendas.
- Estatísticas por setup A/B/C: n, win rate, mediana, média, profit factor e hold médio.
- Nova aba `📈 Trading Lab`.
- Cooldown de 6h por token para evitar duplicar artificialmente a amostra.

# MemeScope v16 — Solana Security Engine

- Integração server-side com **GoPlus Token Security API for Solana**.
- Integração opcional com **Solscan API** (`SOLSCAN_API_KEY`) para holders, concentração e mint/freeze authority.
- Security Score 0–100 separado de Momentum/Continuation.
- Risk levels: LOW / MEDIUM / HIGH / CRITICAL.
- Critical Security Gate pode retirar automaticamente uma moeda do Live Radar, sem apagar o score bruto.
- Verifica mintability, freeze/close/balance authorities quando disponíveis, holder concentration, creator concentration, LP locking e autoridades potencialmente maliciosas.
- Máximo de 2 security checks por ciclo + persistência/recheck em Redis para não queimar limites de API.
- Sem Solscan key, MemeScope continua funcional com assessment parcial.
- Novo link direto para Solscan em candidatos Solana.
- Nenhuma API key é enviada ao browser.

# MemeScope v15 — Momentum Continuation

- `Continuation Score` separado do `Early Momentum Score`.
- Usa Early Momentum, Activity Quality, buys/sells, aceleração de volume, liquidez e penalização por movimento já demasiado esticado.
- Não é apresentado como probabilidade de lucro.
- Backtest automático desde a primeira deteção: +1m, +3m, +5m, +10m, +15m, +30m e +60m.
- Cada horizonte exige observação suficientemente próxima; caso contrário fica N/D.
- MFE/MAE observados durante a primeira hora.
- Painel agregado com mediana, percentagem positiva e tamanho da amostra.
- O backtest de +5m só influencia o Continuation Score depois de n≥20.
- Com Cron ~2m, +1m terá frequentemente menos amostra de propósito.

# MemeScope v14 — Transaction Quality / Anti-Inflation

## New Token Radar
- Added `Activity Quality` (0–100) using only verifiable aggregate DexScreener data.
- Added estimated average USD turnover per 5m transaction: `volumeM5 / (buysM5 + sellsM5)`.
- Transaction-count and buy-ratio contributions are now discounted when activity quality is poor.
- Added explicit activity penalty to Early Momentum.
- Critical patterns (many transactions with extremely little real volume) can be excluded from Live Radar.
- UI shows raw score → adjusted score, Activity Quality, average volume/transaction and penalty.
- Warnings deliberately say `suspicious/inflated activity`, not `fake buys`, because aggregate DEX data cannot prove individual transactions are fake.

## Important limitation
DexScreener's public pair data used by MemeScope does not expose each trade's individual USD amount. Therefore this version **does not fabricate a count of `<$0.01` buys**. Exact microtransaction buckets would require a chain transaction provider/RPC and additional rate-limit handling.

# MemeScope v13 — Radar Memory

## New Token Radar
- `Live Radar` now contains only tokens that pass all Radar gates in the current refresh.
- Tokens no longer disappear when they stop qualifying. They move to `Detetados recentemente` for 48 hours.
- Recently detected tokens are explicitly marked `Lost Momentum` or `Stale`; they are never presented as an active Breakout/Explosive signal.
- Radar persistence now tracks:
  - first detected timestamp;
  - first detected price;
  - first detected Early Momentum score;
  - last seen timestamp;
  - last time the token qualified for Live Radar;
  - current price;
  - peak price since detection;
  - current return since detection;
  - peak return since detection;
  - current Radar status and reason for losing qualification.
- Existing Redis TTL remains 8 days, so the historical state survives browser refreshes and serverless invocations.
- CoinGecko verification / Pre-CoinGecko tracking / listing-effect metrics remain intact.

## Validation
- Syntax/transpile validation passed for all 59 TypeScript/TSX files.
- A complete `npm ci` could not finish within the execution window, so Vercel remains the final full dependency/type/build check.

# MemeScope v12 — Dual Source + Pre-CoinGecko tracking

- New Token Radar mantiene DexScreener como fuente primaria de descubrimiento temprano.
- Cada candidato muestra ahora `Source: DexScreener` o `Source: CoinGecko`.
- Si un contrato existe en ambas fuentes, CoinGecko tiene prioridad como `Source`, pero se conserva `Origem: DexScreener` y la fecha/precio de la primera detección de MemeScope.
- Verificación CoinGecko por contrato, no por símbolo/nombre, para evitar asociaciones ambiguas.
- Máximo de 4 verificaciones CoinGecko por ciclo + recheck persistente cada 15 min para DEX-only, reduciendo presión sobre rate limits.
- Nuevo estado `DEX Mature`: tokens de 6h–7d con liquidez y actividad sostenidas, aunque ya no estén explotando en los últimos 5 minutos.
- Nuevo filtro `Pre-CoinGecko`: contrato confirmado como ainda no listado en CoinGecko por MemeScope.
- Se guarda `coingeckoFirstSeenAt` como la primera confirmación OBSERVADA por MemeScope. No se presenta como fecha oficial de listing.
- Si MemeScope confirmó primero `not_listed` y posteriormente `listed`, registra el evento `DEX-only → CoinGecko` y el precio en ese momento.
- Nuevo panel `CoinGecko Listing Effect`: mediana de retorno y porcentaje positivo a +15m/+1h/+6h/+24h usando únicamente transiciones observadas.
- Los outcomes usan ventanas de tolerancia; si faltó monitorización alrededor del horizonte, se guarda N/D en vez de falsear el resultado.
- Dashboard cards/table muestran Source: CoinGecko cuando hay MarketData de CoinGecko y DexScreener para tokens DEX-only.

# MemeScope v10 — Tendências resilientes

- GDELT: as 3 pesquisas passam a correr em paralelo, evitando o padrão 10s + 10s + 10s observado nos logs da Vercel.
- Fallback: Google News RSS é consultado em paralelo e mantém Tendências útil quando GDELT está indisponível.
- Cache: resultados indisponíveis/vazios nunca são guardados como um feed fresco válido.
- Stale fallback: se todas as fontes falharem, o último feed válido pode ser mostrado como cache recente.
- Observabilidade: falhas de GDELT/RSS aparecem nos Runtime Logs da Vercel com mensagens explícitas.
- UI: mostra `GDELT + RSS`, `RSS fallback` ou `GDELT` conforme a fonte efetivamente usada.
- Mantidas as correções de identidade/token da v9 fixed e todo o Opportunity Engine/Redis/Cron existente.

# MemeScope v9 fixed — production fixes

- Tendências: GDELT now uses multiple smaller queries with partial-failure tolerance instead of one all-or-nothing query.
- Tendências: safer article→token association. Plain ambiguous ticker text no longer links a token; cashtags or full project names are required.
- Coin details: the modal forwards the already-known CoinGecko ID and the API verifies it against the exact contract address before using it.
- Coin details: DexScreener `dexId` is no longer incorrectly displayed as a token symbol (e.g. “uniswap”).
- Existing Redis/Cron/Opportunity Engine behavior is preserved.

# MemeScope — final hardening (ChatGPT)

Esta versão parte de `memescope-para-github_6.zip` e aplica as correções finais de fiabilidade discutidas na auditoria.

## Alterações principais

- **Evidence Gate:** `Strong Opportunity` exige momentum real, anomalia de volume >= 1.5x e histórico mínimo; `Very Strong` exige confirmação adicional de volume e desequilíbrio de transações.
- **Velocidade temporal real:** a aceleração usa os timestamps efetivos dos snapshots, em vez de assumir exatamente 5/10/45 minutos.
- **Baseline de volume menos correlacionado:** `volume.m5` histórico é amostrado em buckets de 5 minutos antes de mediana/MAD.
- **Cooldown server-side:** StoredSignals têm cooldown de 30 minutos, preservado mesmo quando o token regressa a `no_signal`.
- **Backtesting com tolerância:** +5m/+15m/+1h/+6h/+24h só aceita snapshots suficientemente próximos do horizonte pedido; dados incorretamente distantes ficam N/D.
- **Backfill equilibrado:** sinais antigos de +24h não bloqueiam outcomes recentes de +5m/+15m; cada horizonte tem quota própria por ciclo.
- **MFE/MAE acumulativos:** picos/quedas anteriores não são perdidos quando o histórico rolante descarta snapshots antigos.
- **Retenção de snapshots:** TTL aumentado para 30h para suportar o horizonte de +24h com margem operacional.
- **Teste adicional:** score alto sem anomalia de volume não pode ser promovido a Strong apenas por renormalização.

## Validação executada neste ambiente

- Verificação sintática de todos os ficheiros `.ts/.tsx`: **53 ficheiros, 0 erros de sintaxe**.
- Compilação TypeScript isolada do núcleo do Opportunity Engine: **OK**.
- Smoke tests executados diretamente sobre o Opportunity Engine compilado:
  - aceleração + volume 8x + liquidez/compras suficientes -> Strong/Very Strong: **OK**;
  - momentum forte sem anomalia de volume -> não Strong: **OK**.

`npm ci` completo não foi executado nesta pasta final para não introduzir `node_modules` no ZIP. No teu computador/Claude, corre antes de deploy:

```bash
npm ci
npm test
npm run lint
npm run build
```

## v9 — Aba Tendências / Catalyst Radar

- Nova aba interna **Tendências**, separada da dashboard principal.
- Novo endpoint server-side `GET /api/trends` com cache de 5 minutos.
- Integração de notícias recentes via **GDELT DOC 2.0** (janela de 12h, sem API key).
- Classificação heurística e transparente de catalisadores: influencer (inclui menções de Elon Musk), listing/exchange, adoção, regulação, segurança/risco e movimentos fortes de mercado.
- `strength` mede recência + sinais explícitos no título; **não é probabilidade de lucro**.
- Filtros de notícias: Todas / Positivas / Risco / Neutras.
- Liga automaticamente notícias a tokens já presentes no MemeScope por nome/símbolo, quando o match é suficientemente claro.
- Secção “Em tendência no mercado” reaproveita o CoinGecko Trending já existente no Discovery Engine.
- A v9 **não injeta notícias diretamente no Opportunity Score**: primeiro recolhemos/observamos os catalisadores e evitamos que uma notícia negativa ou uma menção isolada crie artificialmente um sinal de compra.
- X/Twitter e Reddit permanecem preparados para uma iteração posterior com fontes oficiais.

# MemeScope v11 — New Token Radar
- Nova terceira aba `🚀 New Token Radar`.
- Descoberta server-side via feeds públicos de perfis/boosts recentes da DexScreener e resolução de pares em batch.
- Hard gates: par <48h, liquidez >=$10k, volume 5m >=$1.5k, >=10 transações/5m.
- Early Momentum Score: momentum 5m/1h + volume/liquidez + atividade + buy imbalance + idade. Boost pago quase não aumenta score e é marcado como risco.
- Estados Emerging / Breakout / Explosive com critérios progressivamente mais exigentes.
- Redis guarda firstDetectedAt e firstDetectedPrice por 72h, para medir retorno desde a deteção.
- O cron atualiza o radar mesmo com a página fechada. Não há compra automática nem adição automática à watchlist.
