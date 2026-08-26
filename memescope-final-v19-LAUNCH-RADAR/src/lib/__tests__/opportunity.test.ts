import { describe, it, expect } from "vitest";
import { computeOpportunity } from "../opportunity";
import { Snapshot } from "../storage/types";
import { DexPairData, MarketData } from "../types";

const NOW = Date.now();

function snap(overrides: Partial<Snapshot> & { minutesAgo: number }): Snapshot {
  const { minutesAgo, ...rest } = overrides;
  return {
    tokenKey: "test:token",
    chain: "solana",
    address: "test-address",
    coingeckoId: null,
    timestamp: NOW - minutesAgo * 60_000,
    price: 1,
    marketCap: 5_000_000,
    liquidityUsd: 80_000,
    volumeM5: 1000,
    volumeH1: 12_000,
    volumeH6: 72_000,
    volumeH24: 288_000,
    buysM5: 5,
    sellsM5: 5,
    buysH1: 60,
    sellsH1: 60,
    buysH6: 360,
    sellsH6: 360,
    buysH24: 1440,
    sellsH24: 1440,
    ...rest,
  };
}

/** Gera um histórico "de fundo" flat, a cada 2 minutos, cobrindo os últimos 90 minutos. */
function flatHistory(overrides: Partial<Snapshot> = {}): Snapshot[] {
  const points: Snapshot[] = [];
  for (let m = 90; m >= 2; m -= 2) {
    points.push(snap({ minutesAgo: m, ...overrides }));
  }
  return points;
}

const market: MarketData = {
  id: "test",
  symbol: "TEST",
  name: "Test Token",
  image: null,
  price: 1,
  marketCap: 5_000_000,
  fdv: 5_000_000,
  volume24h: 288_000,
  change1h: 0,
  change24h: 0,
  change7d: 0,
  change30d: 0,
  circulatingSupply: 5_000_000,
  totalSupply: 5_000_000,
  ath: 1,
  athChangePercent: 0,
  lastUpdated: new Date().toISOString(),
};

const dex: DexPairData = {
  pairAddress: "pair",
  dexId: "raydium",
  chain: "solana",
  priceUsd: 1,
  liquidityUsd: 80_000,
  volume24hUsd: 288_000,
  txns24h: { buys: 1440, sells: 1440 },
  pairCreatedAt: null,
  fdv: 5_000_000,
  volumeM5: 1000,
  volumeH1: 12_000,
  volumeH6: 72_000,
  txnsM5: { buys: 5, sells: 5 },
  txnsH1: { buys: 60, sells: 60 },
  txnsH6: { buys: 360, sells: 360 },
  priceChangeM5: 0,
  priceChangeH1: 0,
  priceChangeH6: 0,
  priceChangeH24: 0,
};

describe("Opportunity Engine — cenários sintéticos (Fase 19 do hardening)", () => {
  it("A. preço flat + volume flat => No Signal", () => {
    const history = flatHistory();
    const result = computeOpportunity(history, market, dex, []);
    expect(result.classification).toBe("no_signal");
  });

  it("B. preço a crescer de forma constante e suave, sem aceleração => momentum moderado, não Very Strong", () => {
    // +0.5% a cada 2 minutos, de forma constante — sem aceleração entre segmentos.
    const points: Snapshot[] = [];
    let price = 1;
    for (let m = 90; m >= 2; m -= 2) {
      points.push(snap({ minutesAgo: m, price }));
      price *= 1.005;
    }
    const latestPrice = price;
    const result = computeOpportunity(
      points,
      { ...market, price: latestPrice },
      { ...dex, priceUsd: latestPrice },
      []
    );
    expect(result.classification).not.toBe("very_strong_opportunity");
    expect(result.classification).not.toBe("strong_opportunity");
  });

  it("C. aceleração recente + volume 8x + compras suficientes + boa liquidez => Strong/Very Strong", () => {
    const points = flatHistory({ price: 1 });
    // Últimos minutos: preço acelera (segmentos não sobrepostos com velocidade crescente).
    points.push(snap({ minutesAgo: 15, price: 1.03 })); // +3% até 15m atrás
    points.push(snap({ minutesAgo: 5, price: 1.08 })); // +5% adicional no segmento 5-15m
    const latestPrice = 1.2; // +11% nos últimos 5 minutos — velocidade muito maior que a anterior
    const latestSnap = snap({
      minutesAgo: 0,
      price: latestPrice,
      volumeM5: 8000, // 8x o baseline (1000/5min)
      buysM5: 40,
      sellsM5: 10, // 50 transações, forte predomínio de compras
      liquidityUsd: 300_000,
      marketCap: 8_000_000,
    });
    const history = [...points, latestSnap];

    const result = computeOpportunity(
      history,
      { ...market, price: latestPrice, marketCap: 8_000_000 },
      { ...dex, priceUsd: latestPrice, liquidityUsd: 300_000, volumeM5: 8000, txnsM5: { buys: 40, sells: 10 } },
      []
    );

    expect(["strong_opportunity", "very_strong_opportunity"]).toContain(result.classification);
    expect(result.invalidatedByRisk).toBe(false);
  });

  it("D. mesmos dados de C mas com liquidez crítica => score bruto pode ser alto, classification No Signal", () => {
    const points = flatHistory({ price: 1, liquidityUsd: 3_000 });
    points.push(snap({ minutesAgo: 15, price: 1.03, liquidityUsd: 3_000 }));
    points.push(snap({ minutesAgo: 5, price: 1.08, liquidityUsd: 3_000 }));
    const latestPrice = 1.2;
    const latestSnap = snap({
      minutesAgo: 0,
      price: latestPrice,
      volumeM5: 8000,
      buysM5: 40,
      sellsM5: 10,
      liquidityUsd: 3_000, // abaixo do limiar crítico
      marketCap: 8_000_000,
    });
    const history = [...points, latestSnap];

    const result = computeOpportunity(
      history,
      { ...market, price: latestPrice, marketCap: 8_000_000 },
      { ...dex, priceUsd: latestPrice, liquidityUsd: 3_000, volumeM5: 8000, txnsM5: { buys: 40, sells: 10 } },
      []
    );

    expect(result.classification).toBe("no_signal");
    expect(result.invalidatedByRisk).toBe(true);
    // o score bruto continua acessível para debugging, mesmo invalidado
    expect(result.total).not.toBeNull();
  });

  it("E. 2 buys / 1 sell (amostra minúscula) => não deve produzir buyImbalance forte", () => {
    const points = flatHistory();
    const latestSnap = snap({ minutesAgo: 0, buysM5: 2, sellsM5: 1, buysH1: 2, sellsH1: 1, buysH6: 2, sellsH6: 1, buysH24: 2, sellsH24: 1 });
    const history = [...points, latestSnap];

    const result = computeOpportunity(
      history,
      market,
      { ...dex, txnsM5: { buys: 2, sells: 1 }, txnsH1: { buys: 2, sells: 1 }, txnsH6: { buys: 2, sells: 1 }, txns24h: { buys: 2, sells: 1 } },
      []
    );

    // amostra demasiado pequena em todas as janelas -> componente indisponível, nunca "forte"
    expect(result.components.buyImbalance).toBeNull();
  });

  it("F. token microcap sem volume/liquidez suficiente => não deve receber score alto só por market cap pequeno", () => {
    const points = flatHistory({ marketCap: 50_000, liquidityUsd: 2_000, volumeM5: 5 });
    const latestSnap = snap({ minutesAgo: 0, marketCap: 50_000, liquidityUsd: 2_000, volumeM5: 5 });
    const history = [...points, latestSnap];

    const result = computeOpportunity(
      history,
      { ...market, marketCap: 50_000 },
      { ...dex, liquidityUsd: 2_000, volumeM5: 5 },
      []
    );

    expect(result.classification).toBe("no_signal");
    expect(result.total === null || result.total < 80).toBe(true);
  });

  it("G. snapshot mais recente stale => No Signal (freshness gate)", () => {
    const points: Snapshot[] = [];
    // Histórico inteiro termina há 20 minutos — nenhum snapshot mais recente do que isso,
    // muito acima do limiar de frescura (6 min), independentemente dos dados em si.
    for (let m = 110; m >= 20; m -= 2) {
      points.push(snap({ minutesAgo: m, price: 1.2, volumeM5: 9000, buysM5: 40, sellsM5: 5 }));
    }

    const result = computeOpportunity(points, market, dex, []);

    expect(result.classification).toBe("no_signal");
    expect(result.risks.some((r) => r.toLowerCase().includes("stale"))).toBe(true);
  });

  it("H. sinal forte -> no signal -> sinal forte outra vez: o motor é sem estado (stateless)", () => {
    // O opportunity.ts em si não guarda memória entre chamadas — cabe ao monitor.ts (com
    // lastClassification em storage) decidir cooldown/rearm. Aqui confirmamos que o mesmo
    // input forte produz sempre a mesma classificação forte, independentemente de chamadas anteriores.
    const points = flatHistory({ price: 1 });
    points.push(snap({ minutesAgo: 15, price: 1.03 }));
    points.push(snap({ minutesAgo: 5, price: 1.08 }));
    const strongSnap = snap({ minutesAgo: 0, price: 1.2, volumeM5: 8000, buysM5: 40, sellsM5: 10, liquidityUsd: 300_000, marketCap: 8_000_000 });
    const strongHistory = [...points, strongSnap];
    const strongMarket = { ...market, price: 1.2, marketCap: 8_000_000 };
    const strongDex = { ...dex, priceUsd: 1.2, liquidityUsd: 300_000, volumeM5: 8000, txnsM5: { buys: 40, sells: 10 } };

    const first = computeOpportunity(strongHistory, strongMarket, strongDex, []);
    const flat = computeOpportunity(flatHistory(), market, dex, []);
    const second = computeOpportunity(strongHistory, strongMarket, strongDex, []);

    expect(["strong_opportunity", "very_strong_opportunity"]).toContain(first.classification);
    expect(flat.classification).toBe("no_signal");
    expect(second.classification).toBe(first.classification);
  });
  it("I. score alto sem anomalia de volume não pode virar Strong por renormalização", () => {
    const points = flatHistory({ price: 1, volumeM5: 1000 });
    points.push(snap({ minutesAgo: 15, price: 1.02, volumeM5: 1000 }));
    points.push(snap({ minutesAgo: 5, price: 1.08, volumeM5: 1000 }));
    points.push(snap({ minutesAgo: 0, price: 1.2, volumeM5: 1000, buysM5: 80, sellsM5: 20, liquidityUsd: 500_000 }));

    const result = computeOpportunity(
      points,
      { ...market, price: 1.2, marketCap: 8_000_000 },
      { ...dex, priceUsd: 1.2, liquidityUsd: 500_000, volumeM5: 1000, txnsM5: { buys: 80, sells: 20 } },
      []
    );

    expect(["no_signal", "watch", "high_momentum_watch"]).toContain(result.classification);
    expect(result.metrics.volumeRatio === null || result.metrics.volumeRatio < 1.5).toBe(true);
  });

});
