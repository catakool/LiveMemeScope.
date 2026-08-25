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
