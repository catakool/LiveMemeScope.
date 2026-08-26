import { RiskTier, Chain } from "./types";

export const TIER_META: Record<RiskTier, { label: string; color: string }> = {
  established: { label: "Consolidada", color: "var(--tier-established)" },
  momentum: { label: "Momentum atual", color: "var(--tier-momentum)" },
  "high-risk": { label: "Maior risco", color: "var(--tier-high-risk)" },
  extreme: { label: "Risco extremo", color: "var(--tier-extreme)" },
};

export const CHAIN_LABEL: Record<Chain, string> = {
  ethereum: "Ethereum",
  solana: "Solana",
  base: "Base",
  bsc: "BNB Chain",
  unknown: "Nativa / N.D.",
};
