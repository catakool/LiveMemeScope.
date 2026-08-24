# MemeScope

Dashboard educativo para acompanhar, analisar e comparar memecoins. Apresenta dados
de mercado (CoinGecko) e dados on-chain de liquidez/volume (DexScreener), calcula
duas pontuações transparentes — **Opportunity Score** e **Risk Score** — e permite
criar alertas locais com notificações do navegador.

> Esta aplicação apresenta dados e indicadores educativos. Não constitui aconselhamento
> financeiro. As memecoins são ativos altamente especulativos e podem perder todo o seu valor.

---

## 1. Arquitetura

```
Browser (Next.js App Router, client components)
        │
        ├── /api/coins            → Discovery Feed + tokens manuais + Opportunity Score anexado
        ├── /api/coins/[id]       → detalhe + histórico + Opportunity Score + sinais recentes
        ├── /api/verify-token     → valida um endereço de contrato via DexScreener (preview)
        ├── /api/tokens/register  → regista um token verificado no servidor (fonte de verdade)
        ├── /api/tokens           → lista tokens vigiados (debug/transparência)
        ├── /api/signals          → histórico de sinais gerados (para backtesting futuro)
        │
        ├── lib/coingecko.ts, lib/dexscreener.ts   (fetch + cache TTL + fallback obsoleto)
        ├── lib/discovery.ts       (Discovery Engine — "que moedas são interessantes?")
        ├── lib/scoring.ts         (Opportunity/Risk Score "estáticos", ponto a ponto)
        ├── lib/tokenRegistry.ts   (fonte de verdade unificada: descoberta + manuais)
        ├── lib/opportunity.ts     (Opportunity Engine — "que moedas estão a acelerar?")
        ├── lib/storage/           (snapshots/sinais persistentes — Redis via Upstash)
        └── lib/monitor.ts         (job chamado pelo Cron Job da Vercel — ver vercel.json)

vercel.json (cron */2min) ──► GET /api/cron/monitor ──► lib/monitor.ts
```

- As chamadas às APIs externas correm **sempre no servidor** (rotas `/api/*`), nunca
  diretamente do browser — isto protege eventuais chaves de API e evita problemas de CORS.
- Uma cache em memória (`lib/cache.ts`) com TTL curto (30–60s) e *request coalescing*
  reduz o número de pedidos às APIs externas e respeita os seus limites de taxa.
- Se uma API externa falhar, a app tenta devolver o último valor em cache (marcado
  como "dados atrasados") antes de assumir "API indisponível". **Nunca inventa valores.**
- A recolha de dados para deteção de aceleração (Opportunity Engine) vive num
  **Cron Job server-side**, não num polling do browser — ver secção 8.

## 2. Estrutura de pastas

```
vercel.json                                → agenda o Cron Job de monitorização
src/
  app/
    layout.tsx, globals.css, page.tsx      → layout raiz e dashboard principal
    api/coins/route.ts                     → Discovery Feed + tokens manuais + Opportunity Score
    api/coins/[id]/route.ts                → detalhe de uma moeda + Opportunity Score + sinais
    api/verify-token/route.ts              → verificação de contrato (preview, sem registar)
    api/tokens/register/route.ts           → regista um token manual no servidor
    api/tokens/route.ts                    → lista tokens vigiados
    api/signals/route.ts                   → histórico de sinais gerados
    api/cron/monitor/route.ts              → endpoint chamado pelo Cron Job (protegido por CRON_SECRET)
  components/                              → UI (cartões, gráficos, tabela, alertas, Live Opportunities…)
  hooks/useCoins.ts                        → polling client-side + avaliação de alertas
  lib/
    types.ts                → tipos partilhados
    discovery.ts             → Discovery Engine
    scoring.ts                → Opportunity/Risk Score "estáticos" (ponto a ponto)
    opportunity.ts            → Opportunity Engine (séries temporais, aceleração)
    tokenRegistry.ts          → fonte de verdade unificada de tokens vigiados
    monitor.ts                → lógica do job de monitorização (chamado pelo cron)
    catalystProvider.ts       → interface preparada para catalisadores futuros (sem implementação)
    storage/                  → camada de persistência (Redis via Upstash + fallback em memória)
    coingecko.ts / dexscreener.ts          → wrappers das APIs externas
    alerts.ts / watchlist.ts               → localStorage (regras, watchlist pessoal, tokens custom)
    format.ts / tiers.ts                   → helpers de formatação e metadados visuais
```

## 3. Modelo de dados e descoberta automática

**A lista já não é fixa.** Em vez de uma watchlist escolhida manualmente, o MemeScope
gera a lista de "memecoins com potencial" sozinho, a cada atualização, combinando três
sinais reais (`src/lib/discovery.ts`):

1. **Tendência** — moedas presentes em `/search/trending` da CoinGecko (pesquisas
   recentes de outros utilizadores).
2. **Momentum** — a mesma fórmula do Opportunity Score (ver secção 4), aplicada a toda
   a categoria "Meme" da CoinGecko (até 150 moedas).
3. **Par novo** — idade do par on-chain (DexScreener) ou data de génese do token,
   inferior a 30 dias.

O motor: (1) busca as 150 moedas da categoria "Meme" por volume; (2) calcula uma
pontuação barata de ordenação (`rankScore`) só com dados de mercado; (3) para as 16
melhores, vai buscar o endereço do contrato e a liquidez/idade real do par on-chain;
(4) recalcula os scores finais já com esses dados e etiqueta cada moeda com os motivos
("Em tendência" / "Momentum" / "Par novo") — nunca com valores inventados.

- `TokenDefinition` — construído dinamicamente para cada moeda descoberta (id
  CoinGecko, símbolo, chain, contrato se encontrado, nível de risco **estimado por
  capitalização de mercado** — uma heurística, não uma classificação editorial).
- `MarketData` — preço, capitalização, FDV, volume, variações 1h/24h/7d/30d (CoinGecko).
- `DexPairData` — par, liquidez, volume on-chain, compradores/vendedores, idade do par
  (DexScreener), só pedido quando existe um endereço de contrato confirmado pela
  própria CoinGecko (campo `platforms` da ficha oficial da moeda).
- `ScoreResult` — pontuação 0–100, `confidence` (fração do peso da fórmula com dados
  reais) e a lista de `components` (cada um com peso, valor e disponibilidade).

### Tokens de risco extremo adicionados manualmente

Além da descoberta automática, o painel "Adicionar token de risco extremo" continua
disponível para tokens que a CoinGecko ainda não indexa (lançamentos muito recentes,
tokens sem categoria "Meme" atribuída, etc.). Aí, o utilizador cola sempre o endereço
do contrato copiado da fonte oficial do projeto — a app nunca identifica um token
apenas por nome ou símbolo.

## 4. Fórmula das pontuações

Ambas as pontuações são uma **média ponderada apenas dos componentes com dados reais
disponíveis** (o peso dos componentes em falta é excluído do denominador). A
`confidence` reportada é a fração do peso total da fórmula coberta por dados reais.

### Opportunity Score (pesos)
| Componente | Peso | Fonte |
|---|---|---|
| Momentum 1h / 24h / 7d / 30d | 8% / 15% / 13% / 9% | CoinGecko |
| Crescimento de volume | 12% | CoinGecko (histórico) |
| Volume / Capitalização | 10% | CoinGecko |
| Crescimento de liquidez | 8% | não implementado (requer snapshots históricos) |
| Compradores vs. vendedores 24h | 10% | DexScreener |
| Consistência da tendência | 10% | CoinGecko (histórico) |
| Interesse social | 5% | não implementado (sem fonte verificável integrada) |

### Risk Score (pesos, quanto mais alto mais arriscado)
| Componente | Peso | Fonte |
|---|---|---|
| Liquidez reduzida | 15% | DexScreener + CoinGecko |
| Concentração de holders | 12% | não implementado |
| Diferença Cap./FDV | 13% | CoinGecko |
| Idade do token | 10% | DexScreener |
| Liquidez não bloqueada | 8% | não implementado |
| Mint/freeze authority ativa | 10% | não implementado (requer RPC on-chain) |
| Movimentos da carteira do criador | 8% | não implementado |
| Contrato não verificado | 7% | não implementado (requer explorador de blockchain) |
| Possível volume artificial | 9% | DexScreener (heurística volume/liquidez) |
| Honeypot / taxas anormais | 3% | não implementado (ex.: honeypot.is) |
| Quedas abruptas / volatilidade | 5% | CoinGecko (heurística) |

Os componentes marcados "não implementado" aparecem na interface como **"não
disponível"** e reduzem a `confidence` da pontuação — nunca são preenchidos com
valores inventados.

## 5. Fontes de dados e limitações

- **CoinGecko** (`/coins/markets`, `/coins/{id}/market_chart`, `/search/trending`,
  `/coins/{id}`): plano gratuito sem chave tem limites de taxa baixos (tipicamente
  10–30 pedidos/min). O motor de descoberta faz, no pior caso (cache fria), cerca de
  18 pedidos por atualização (1 categoria + 1 trending + até 16 detalhes de moeda);
  o detalhe de cada moeda fica em cache 1 hora, por isso as atualizações seguintes são
  muito mais leves. Defina `COINGECKO_API_KEY` no `.env.local` para um plano
  Demo/Pro com limites maiores se notar erros de "API indisponível" com frequência.
- **DexScreener** (`/latest/dex/tokens/{address}`): gratuito, sem chave, ~300
  pedidos/min. Não expõe estado de bloqueio de liquidez, autoridade de mint/freeze,
  concentração de holders nem verificação de contrato — daí esses componentes
  ficarem sempre "não disponíveis" nesta versão.
- Moedas sem endereço de contrato indexado pela CoinGecko (ex.: DOGE, que não vive
  num contrato) não têm dados on-chain — os componentes de risco dependentes de
  liquidez/idade do par ficam "não disponíveis" para esses casos.
- O nível de risco mostrado nos cartões (Consolidada/Momentum/Maior risco/Risco
  extremo) é uma **heurística baseada na capitalização de mercado**, não uma
  classificação editorial — o Risk Score detalhado (com os seus componentes e
  confiança) é a fonte mais fiável para avaliar risco.

## 6. Instalação e arranque local

Requisitos: Node.js 20+.

```bash
npm install
cp .env.example .env.local   # opcional: adicionar COINGECKO_API_KEY
npm run dev                   # http://localhost:3000
```

Para produção:

```bash
npm run build
npm run start
```

## 7. Configuração de produção (Redis + Cron)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `COINGECKO_API_KEY` | Não | Chave do plano Demo/Pro da CoinGecko, para limites de taxa mais altos. |
| `KV_REST_API_URL` | Sim, em produção | URL REST do Redis (Upstash). Injetada automaticamente ao instalar a integração **"Upstash for Redis"** a partir do Vercel Marketplace. |
| `KV_REST_API_TOKEN` | Sim, em produção | Token REST do Redis (Upstash), injetado da mesma forma. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Alternativa | Nomes alternativos aceites, caso a integração os injete com este nome em vez de `KV_REST_API_*`. |
| `CRON_SECRET` | Recomendada em produção | Protege `/api/cron/monitor`. A Vercel envia-o automaticamente como `Authorization: Bearer <valor>` nas chamadas do próprio Cron Job quando esta variável está definida no projeto. Sem ela, o endpoint fica sem autenticação (aceitável em desenvolvimento local, não em produção). |

**Sem `KV_REST_API_URL`/`KV_REST_API_TOKEN` configuradas**, a aplicação continua a
funcionar (build, arranque e todas as rotas respondem), mas usa um armazenamento
em memória **não persistente** para snapshots/sinais/tokens vigiados — perde-se a
cada reinício do processo, e em produção (serverless) isso pode acontecer a
qualquer momento. É apenas um modo de desenvolvimento local sem base de dados; a
resposta de `/api/coins` inclui sempre `"storage": "memory" | "redis"` para que
saiba em que modo está a correr.

### Configurar o Redis (Upstash) na Vercel — passo a passo

1. No projeto na Vercel, vá a **Storage** (ou **Marketplace** → categoria "Storage").
2. Procure **"Upstash for Redis"** e clique em **Add** / **Install**.
3. Siga o assistente para criar uma base de dados Redis e ligá-la a este projeto.
4. A Vercel injeta automaticamente `KV_REST_API_URL` e `KV_REST_API_TOKEN` nas
   variáveis de ambiente do projeto (Production, Preview e Development, consoante
   escolher). Não precisa de copiar/colar nada manualmente.
5. Redeploy o projeto para que as novas variáveis fiquem disponíveis nas funções.
6. (Opcional mas recomendado) Em **Settings → Environment Variables**, adicione
   `CRON_SECRET` com um valor aleatório à sua escolha (ex.: gerado com
   `openssl rand -hex 32`).

### O Cron Job de monitorização

O ficheiro `vercel.json` define:

```json
{ "crons": [{ "path": "/api/cron/monitor", "schedule": "0 0 * * *" }] }
```

**Isto corre só uma vez por dia.** É o máximo permitido pelo Cron Job nativo da
Vercel no plano **Hobby** (gratuito) — planos com frequência menor que "uma vez
por dia" falham no deploy nesse plano. Isto está documentado oficialmente em
vercel.com/docs/cron-jobs/usage-and-pricing.

**Isto significa que, tal como está, o Opportunity Engine só acumula um
snapshot por dia** — sem histórico de curto prazo suficiente para detetar
aceleração em tempo quase real, que era o objetivo original. Para o sistema
funcionar como pensado, tens duas opções:

**Opção A — Upgrade para o plano Pro da Vercel** (permite cron a cada minuto).
Depois de mudar de plano, muda o `schedule` de volta para `"*/2 * * * *"`
(a cada 2 minutos) e faz redeploy.

**Opção B — Manter o plano Hobby (grátis) e usar um agendador externo**, que não
está sujeito ao limite do Cron Job nativo da Vercel (é só uma chamada HTTP normal
à tua app, como qualquer visita):

1. Cria conta grátis em [cron-job.org](https://cron-job.org) (ou usa GitHub
   Actions com um `schedule` no workflow, se preferires).
2. Configura para chamar, a cada 1-2 minutos:
   `GET https://o-teu-dominio.vercel.app/api/cron/monitor`
3. Adiciona o cabeçalho `Authorization: Bearer <o-valor-do-teu-CRON_SECRET>`
   (o mesmo que definiste nas variáveis de ambiente da Vercel).
4. Guarda — o serviço externo passa a "acordar" o teu endpoint na frequência
   que quiseres, sem depender do cron nativo da Vercel nem do seu limite do
   plano Hobby.


## 8. Opportunity Engine (deteção de aceleração em tempo quase real)

Além do Discovery Engine (secção 3), existe agora um segundo motor, **separado e
independente**, em `src/lib/opportunity.ts`:

- **Discovery Engine** responde "que moedas são interessantes?" (ranking estático,
  categoria Meme + tendência).
- **Opportunity Engine** responde "que moedas estão a acelerar agora?" (analisa a
  série temporal de snapshots, não um único ponto no tempo).

### Arquitetura

```
vercel.json (cron */2min)
  └─ GET /api/cron/monitor (protegido por CRON_SECRET)
       └─ lib/monitor.ts: runMonitorCycle()
            ├─ atualiza o registo de tokens vigiados (lib/tokenRegistry.ts)
            │    — une tokens descobertos automaticamente + adicionados manualmente
            ├─ obtém dados de mercado (CoinGecko) e on-chain (DexScreener)
            │    em lote, respeitando limites de taxa (máx. 40 tokens/execução)
            ├─ guarda um snapshot por token (lib/storage — Redis/Upstash)
            ├─ calcula o Opportunity Score (lib/opportunity.ts) a partir do
            │    histórico de snapshots
            └─ regista um novo "sinal" só quando a classificação SOBE de nível
                 face à última conhecida (deduplicação/cooldown — evita spam)

GET /api/coins e GET /api/coins/[id]
  └─ leem os snapshots já guardados (sem chamar APIs externas outra vez) e
       anexam o Opportunity Score a cada moeda devolvida
```

### Por que é preciso um Cron Job (e não `setInterval`)

A aplicação corre em funções serverless (Vercel). Cada pedido pode ser servido por
uma instância diferente e sem estado persistente entre si — um `setInterval`
dentro de uma rota API **não sobrevive** entre invocações e não é fiável em
produção. Por isso a recolha de dados vive num Cron Job da Vercel (`vercel.json`),
independente de haver ou não utilizadores com a página aberta.

### Modelo do snapshot (`lib/storage/types.ts`)

Cada snapshot guardado tem, aproximadamente: `tokenKey, chain, address,
coingeckoId, timestamp, price, marketCap, liquidityUsd, volumeM5/H1/H6/H24,
buys/sellsM5/H1/H6/H24`. Mantém-se um histórico rolante (~200 snapshots por
token, ≈6-7h a uma cadência de 2min) — sem duplicação desnecessária.

### Metodologia do Opportunity Score (pesos ajustáveis, ver `OPPORTUNITY_WEIGHTS`)

| Componente | Peso | O que mede |
|---|---|---|
| Momentum | 25% | Variação de preço em janelas curtas (1m/5m/15m/1h), com deteção de **aceleração** (janelas curtas a subir mais depressa que as longas), não apenas "está a subir" |
| Volume acceleration | 25% | Volume atual (normalizado por hora) vs. média do volume histórico do próprio token — um rácio 8-10x é muito mais relevante do que volume absoluto alto |
| Buy pressure | 20% | Rácio compras/(compras+vendas), na janela mais granular disponível com dados suficientes |
| Liquidity quality | 15% | Liquidez face à capitalização (ou absoluta, se não houver capitalização) |
| Market structure / token age | 10% | Combina idade do par on-chain e dimensão da capitalização — não assume que "pequeno = oportunidade", só descreve a estrutura |
| Catalyst | 5% | Sempre indisponível nesta versão (ver `lib/catalystProvider.ts` — interface pronta, sem fonte fiável integrada) |

Estes pesos **não são definitivos** — são constantes exportadas, fáceis de
ajustar depois de haver dados suficientes para validar a metodologia (ver
secção 10, backtesting).

**Confiança ≠ score.** A `confidence` é a fração do peso total coberta por
componentes com dados reais disponíveis — nunca é igual à pontuação. Um token
recém-vigiado, com pouco histórico, terá sempre confiança baixa mesmo que o
score bruto pareça alto.

**Segurança > momentum.** Um risco crítico (liquidez abaixo de $15k, ou
confiança abaixo de 35%) **invalida** a classificação, forçando-a para
"No Signal", mesmo que a pontuação bruta seja elevada — replicando o exemplo do
pedido original (score 94 + liquidez extrema = "NO SIGNAL / HIGH RISK").

### Classificação

| Score | Classificação |
|---|---|
| 90–100 | Very Strong Opportunity |
| 80–89 | Strong Opportunity |
| 70–79 | High Momentum / Watch |
| 60–69 | Watch |
| < 60 | No Signal |

### Linguagem usada na interface

Nunca "vai subir" ou "lucro garantido". Sempre condicional: "Strong
Opportunity", "High Momentum", "Watch", "High Risk", "Potential Entry" — sempre
acompanhado das razões concretas ("Why now?") e dos riscos identificados.

## 9. Tokens adicionados manualmente (correção do problema original)

Antes desta versão, um token adicionado via "Adicionar token de risco extremo"
ficava guardado **apenas em localStorage** e nunca entrava no pipeline de dados
— aparecia uma vez no ecrã de verificação e depois ficava invisível e congelado.

Isso está corrigido: `POST /api/tokens/register` regista o token no servidor
(`lib/tokenRegistry.ts`, identidade sempre por `chain + endereço de contrato`,
nunca pelo símbolo). A partir daí, o token:

1. entra na lista processada pelo Cron Job de monitorização;
2. começa a acumular snapshots de preço/volume/liquidez;
3. aparece em `/api/coins` (e portanto no dashboard) com dados ao vivo;
4. fica elegível para o Opportunity Engine assim que tiver histórico suficiente;
5. pode disparar alertas (nova métrica `opportunity_signal` em `lib/alerts.ts`).

`localStorage` continua a ser usado (`lib/watchlist.ts`), mas apenas como lista
pessoal de conveniência — nunca mais como fonte de verdade dos dados.

## 10. Histórico de sinais e preparação para backtesting

Cada vez que a classificação de um token sobe de nível pela primeira vez, é
guardado um registo completo (`StoredSignal` em `lib/storage/types.ts`): token,
chain, endereço, timestamp, preço, capitalização, liquidez, volume, score,
componentes, confiança, classificação, razões e riscos. Consultável em
`GET /api/signals` (globalmente) ou `GET /api/signals?tokenKey=...` (por token).

Isto **não implementa ainda** um sistema de backtesting visual — apenas garante
que os dados necessários (preço no momento do sinal) ficam guardados para que,
mais tarde, se possa comparar com o preço passados 5m/15m/1h/6h/24h e assim
avaliar se o Opportunity Score tem valor preditivo real. Nenhuma afirmação de
rentabilidade é feita nesta versão.

## 11. Notas de segurança

- Não há ligação de carteiras, pedido de seed phrases nem execução de transações —
  os alertas usam apenas notificações do navegador (`Notification API`).
- Todos os textos evitam linguagem de aconselhamento financeiro ("compra agora",
  "lucro garantido"); usa-se sempre linguagem condicional ("condições favoráveis",
  "momentum elevado", "risco elevado").
- Dados simulados **não são usados** nesta versão — quando uma API falha, a app
  mostra o último valor real em cache com o estado "dados atrasados" ou, na
  ausência de qualquer valor anterior, "API indisponível". Nunca inventa números.
- Nenhuma variável de ambiente sensível (`KV_REST_API_TOKEN`, `CRON_SECRET`,
  `COINGECKO_API_KEY`) é lida por nenhum componente `"use client"` — todas vivem
  exclusivamente em rotas API e módulos server-side (`lib/storage/*`,
  `lib/coingecko.ts`, `app/api/*`). Confirmado por auditoria de código antes de
  cada entrega.
- Nova dependência: `@upstash/redis` (cliente oficial recomendado pela Vercel
  para Redis desde a descontinuação de `@vercel/kv`). Sem custos ocultos: só é
  usada quando `KV_REST_API_URL`/`KV_REST_API_TOKEN` existem.

## 12. Hardening (fase de robustez do Opportunity Engine)

Esta secção documenta uma segunda ronda de trabalho sobre a arquitetura da
secção 8, focada em **reduzir falsos positivos e tornar as señales mais
defensáveis estatisticamente** — não em adicionar funcionalidades visuais novas.

### 12.1 Identidade de tokens (`tokenKey` vs `coingeckoId`)

Antes, `coingeckoId` era usado como identificador universal na UI — mas um
token adicionado manualmente pode não ter nenhum. Agora:

- `TokenDefinition.tokenKey` (string, sempre definida) é a identidade real,
  no formato `chain:endereço` ou `cg:coingeckoId` (`src/lib/tokenKey.ts`).
- `TokenDefinition.coingeckoId` passou a `string | null` — só existe quando o
  token está mesmo listado na CoinGecko.
- Toda a UI (`CoinCard`, `CoinTable`, `LiveOpportunities`, `AlertsPanel`,
  `alerts.ts`, `page.tsx`) usa `tokenKey` como chave/identidade.
- `GET /api/coins/[id]` aceita agora uma `tokenKey` (URL-encoded) e **nunca
  devolve 404 só porque o token não existe na CoinGecko** — mostra o que a
  DexScreener e o histórico próprio tiverem, com fallback ao último estado
  persistido se as APIs externas falharem.

### 12.2 Remoção de tokens manuais

`DELETE /api/tokens/register` (corpo `{ "key": "<tokenKey>" }`), idempotente.
Remove o registo de vigilância, o estado atual e a última classificação.
**Conserva deliberadamente** os sinais históricos (`StoredSignal`) já gerados
por esse token, para auditoria e para não invalidar dados de backtesting.

### 12.3 Freshness gate

Uma oportunidade nunca aparece como "live" se os dados forem antigos —
`OPPORTUNITY_CONFIG.freshness.maxLiveSnapshotAgeMs` (6 min por omissão). Isto
é verificado **duas vezes**: no momento em que o monitor calcula o score, e
outra vez quando `/api/coins` lê o estado persistido (para o caso de o
próprio job de monitorização ter parado de correr). O score bruto continua
disponível para debugging; só a `classification` é forçada para `no_signal`.

### 12.4 Momentum com segmentos não sobrepostos

Substituído o cálculo anterior (retornos cumulativos sobrepostos de 5m/15m/1h)
por três segmentos independentes — `[0,5m]`, `[5m,15m]`, `[15m,60m]` — convertidos
em "velocidade" (%/min), para detetar **aceleração real**, não apenas "subiu".
A janela de "1 minuto" foi eliminada do score: com o monitor a correr a cada
~1-2min, não há resolução suficiente para a calcular com confiança — fica
sempre `unavailable`, nunca inventada.

### 12.5 Volume acceleration robusto

O baseline de volume passou a usar a **mediana** (não a média) de snapshots
entre 90 e 20 minutos atrás (excluindo deliberadamente os últimos ~20min, para
não deixar o próprio pico contaminar o seu baseline), com dispersão robusta via
MAD. Exige um mínimo de amostras (`minimumBaselineSamples`, 5 por omissão) —
sem isso, o componente fica indisponível em vez de arriscar uma leitura ruidosa.

### 12.6 Transaction Buy Imbalance (antigo "buy pressure")

Renomeado porque a DexScreener só dá **contagens** de compras/vendas, não o
volume monetário de cada lado — não se deve afirmar que se conhece o "fluxo de
capital". Implementado *shrinkage* Bayesiano: com poucas transações, o rácio é
puxado fortemente para 50 (neutro); só com 100+ transações o rácio bruto é
usado quase sem ajuste. Abaixo de `minimumSampleSize` (10), o componente fica
indisponível.

### 12.7 Market cap deixou de ser uma recompensa

Antes, `marketCap < $1M` dava diretamente uma pontuação alta ao componente de
estrutura de mercado — recompensando microcaps por serem pequenos, sem
qualquer condição de qualidade. Agora:

- `marketStructure` mede maturidade/idade do par, com uma penalização (não
  bónus) quando a capitalização é minúscula **e** a liquidez é fraca ao mesmo
  tempo (fragilidade estrutural).
- Criado um campo separado e puramente informativo, `asymmetryPotential`
  (`low`/`medium`/`high`/`very_high`), que reflete o espaço para movimentos
  percentuais grandes — mas **não soma ao score principal**.

### 12.8 Liquidez com função gradual

Substituído o corte abrupto ($15k) por uma função contínua por troços
(`critical` / `veryLow` / `low` / `healthy`, valores em `OPPORTUNITY_CONFIG.liquidity`),
combinada com o rácio liquidez/capitalização. Já não existe uma fronteira
absurda tipo "$14.999 inválido, $15.001 aceitável".

### 12.9 Risk Gates (módulo separado)

`src/lib/riskGates.ts` — `evaluateOpportunityRiskGates()` avalia, de forma
explícita e testável: frescura dos dados, liquidez crítica, confiança
insuficiente, histórico curto, token muito recente + liquidez baixa, subida
extrema seguida de deterioração, e amostra de transações pequena. Devolve
`{ passed, criticalRisks, warnings }`; um `criticalRisk` força a
classificação para `no_signal` **independentemente do score bruto** — a
segurança tem sempre prioridade sobre o momentum.

### 12.10 Estado persistido (o dashboard já não recalcula tudo a cada visita)

Novo tipo `CurrentTokenState` (`lib/storage/types.ts`): o job de monitorização
grava, a cada ciclo, o estado "pronto a mostrar" de cada token (mercado, dados
on-chain, Opportunity Score já calculado). `GET /api/coins` lê este estado em
vez de recalcular — abrir o dashboard em vários browsers/dispositivos **não
multiplica os pedidos às APIs externas**, porque todos leem o mesmo estado no
Redis. Tokens ainda não processados pelo monitor (ex.: acabados de registar)
continuam a ter um fallback de leitura ao vivo, para aparecerem imediatamente.

### 12.11 Batching justo (fairness) no monitor

`fairOrder()` em `lib/monitor.ts`: tokens manuais continuam prioritários, mas
dentro de cada grupo, quem há mais tempo não é processado (`lastProcessedAt`)
sobe na fila — evita que um número grande de tokens manuais deixe tokens
descobertos permanentemente sem atualização (starvation).

### 12.12 Alertas: rearm + cooldown

`lib/alerts.ts`: uma oportunidade forte pode voltar a disparar depois de
regressar a "No Signal" e passar novamente por cima do limiar (rearm
automático), mas há um cooldown mínimo (`OPPORTUNITY_CONFIG.alerts.cooldownMs`,
30min por omissão) entre dois disparos do mesmo token — evita repetir alerta
por variações pequenas (ex.: 84 → 85).

### 12.13 Limpeza e retenção no Redis

TTLs adicionados (`OPPORTUNITY_CONFIG.retention`): estado atual (1h), última
classificação (1 dia), snapshots (1 dia, além do limite por contagem já
existente). **Sinais não têm TTL** — são o registo de backtesting e devem
persistir. Ao remover um token manual, o estado atual e a última classificação
são apagados explicitamente (ver 12.2).

### 12.14 Infraestrutura de backtesting

`StoredSignal` ganhou campos opcionais: `priceAt5m/15m/1h/6h/24h`,
`return5m/15m/1h/6h/24h`, `maxFavorableExcursion`, `maxAdverseExcursion`. A
cada ciclo, o monitor tenta preencher os sinais mais antigos que ainda tenham
campos em falta (`backfillSignalOutcomes()`), usando os snapshots já
guardados. **O score original nunca usa estes dados** — só servem para
avaliação posterior. Não existe ainda um dashboard visual de backtesting, só
a infraestrutura de dados (consultável via `GET /api/signals`).

### 12.15 Observabilidade

`GET /api/health` — endpoint público sem segredos, devolve `status`
(`live`/`stale`/`never_run`), idade da última execução, e contagens da última
corrida do monitor (`tokensConsidered`, `tokensProcessed`, `snapshotsSaved`,
`signalsGenerated`, `apiFailures`). O cabeçalho do dashboard mostra
discretamente "Monitor: há Xmin · Redis/Memória".

### 12.16 Configuração central

Todos os pesos, limiares, janelas e cooldowns vivem em
`src/lib/opportunityConfig.ts` (`OPPORTUNITY_CONFIG`) — nada espalhado pelo
código como "magic numbers". Pronto para recalibrar depois de haver dados de
backtesting reais.

### 12.17 Testes

`src/lib/__tests__/opportunity.test.ts` (Vitest) cobre 8 cenários sintéticos
determinísticos — incluindo os pedidos explicitamente: preço/volume flat →
No Signal; subida constante sem aceleração → não Very Strong; aceleração +
volume 8x + boa liquidez → Strong/Very Strong; os mesmos dados com liquidez
crítica → score bruto alto mas classification No Signal; 2 buys/1 sell → sem
buy imbalance forte; microcap sem volume/liquidez → sem score alto só por ser
pequeno; snapshot obsoleto → No Signal (freshness gate); e confirmação de que
o motor é stateless (a mesma entrada produz sempre a mesma saída — o
cooldown/rearm vive no `monitor.ts`, não no `opportunity.ts`).

Correr com `npm test`.

### 12.18 Limitações conhecidas desta ronda

- Não existe ainda uma UI dedicada para `asymmetryPotential`, para a
  distribuição de outcomes de backtesting, nem para o histórico de sinais
  global — só a infraestrutura de dados (por desenho: esta ronda foi
  explicitamente sobre robustez, não sobre novas superfícies visuais).
- O aviso do Vitest sobre `configLoader: 'native'` (ESM em `vitest.config.ts`)
  é cosmético e não afeta os testes; pode ser resolvido no futuro renomeando
  o ficheiro para `.mts`.
- **Não se afirma que o algoritmo é lucrativo.** A infraestrutura de
  backtesting existe precisamente para poder verificar isso mais tarde, com
  dados reais acumulados ao longo do tempo — não há essa validação ainda.
