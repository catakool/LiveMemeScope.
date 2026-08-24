// Tipos centrais do MemeScope.
// Nada aqui inventa dados: campos que podem faltar são sempre `number | null`.

export type RiskTier = "established" | "momentum" | "high-risk" | "extreme";

export type Chain =
  | "ethereum"
  | "solana"
  | "base"
  | "bsc"
  | "unknown";

/** Entrada estática da watchlist (o "catálogo" de moedas que o dashboard conhece). */
export interface TokenDefinition {
  coingeckoId: string; // id oficial da API CoinGecko, nunca o símbolo
  symbol: string;
  name: string;
  chain: Chain;
  contractAddress: string | null; // null enquanto não verificado
  riskTier: RiskTier;
  /** Tokens extremos só ficam "ativos" depois de o utilizador validar o contrato. */
  verified: boolean;
  note?: string;
}

/** Estado de frescura de uma fonte de dados. */
export type DataStatus = "live" | "stale" | "unavailable";

export interface SourceMeta {
  status: DataStatus;
  lastUpdated: string | null; // ISO string
  source: "coingecko" | "dexscreener" | "cache" | "simulated";
}

/** Dados de mercado de uma moeda, tal como devolvidos pela CoinGecko /coins/markets */
export interface MarketData {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  price: number | null;
  marketCap: number | null;
  fdv: number | null;
  volume24h: number | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  change30d: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  ath: number | null;
  athChangePercent: number | null;
  lastUpdated: string | null;
}

/** Dados on-chain (par/liquidez/volume) vindos do DexScreener. */
export interface DexPairData {
  pairAddress: string | null;
  dexId: string | null;
  chain: Chain;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  txns24h: { buys: number | null; sells: number | null };
  pairCreatedAt: string | null; // ISO
  fdv: number | null;
}

export interface CoinRecord {
  def: TokenDefinition;
  market: MarketData | null;
  dex: DexPairData | null;
  meta: {
    coingecko: SourceMeta;
    dexscreener: SourceMeta;
  };
}

/** Um único componente da pontuação, com o respetivo peso e disponibilidade. */
export interface ScoreComponent {
  key: string;
  label: string;
  weight: number; // peso relativo definido na fórmula (soma total = 1)
  value: number | null; // 0-100, null se não disponível
  available: boolean;
  detail?: string;
}

export interface ScoreResult {
  score: number | null; // 0-100, null se confiança demasiado baixa
  confidence: number; // 0-1, proporção do peso total que teve dados reais
  components: ScoreComponent[];
}

export interface CoinScores {
  opportunity: ScoreResult;
  risk: ScoreResult;
}

export type AlertMetric =
  | "price_above"
  | "price_below"
  | "volume_increase_pct"
  | "liquidity_above"
  | "liquidity_below"
  | "liquidity_drop_pct"
  | "opportunity_score_change"
  | "risk_score_above"
  | "whale_movement";

export interface AlertRule {
  id: string;
  coinId: string;
  metric: AlertMetric;
  threshold: number;
  createdAt: string;
  enabled: boolean;
  lastTriggeredAt?: string | null;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  coinId: string;
  message: string;
  triggeredAt: string;
}

export type BlockchainFilter = Chain | "all";
export type RiskFilter = RiskTier | "all";

/** Motivo pelo qual uma moeda apareceu na secção de descoberta automática. */
export type DiscoveryReason = "trending" | "momentum" | "new_pair";
