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
