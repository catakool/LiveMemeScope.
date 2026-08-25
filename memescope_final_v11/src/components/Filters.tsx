"use client";

import { BlockchainFilter, Chain, RiskFilter, RiskTier } from "@/lib/types";
import { TIER_META, CHAIN_LABEL } from "@/lib/tiers";

export interface FilterState {
  search: string;
  chain: BlockchainFilter;
  tier: RiskFilter;
  minMarketCap: number;
  minLiquidity: number;
  watchlistOnly: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  search: "",
  chain: "all",
  tier: "all",
  minMarketCap: 0,
  minLiquidity: 0,
  watchlistOnly: false,
};

const CHAINS: Chain[] = ["ethereum", "solana", "base", "bsc", "unknown"];
const TIERS: RiskTier[] = ["established", "momentum", "high-risk", "extreme"];

export default function Filters({
  value,
  onChange,
}: {
  value: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const set = <K extends keyof FilterState>(key: K, v: FilterState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <input
        value={value.search}
        onChange={(e) => set("search", e.target.value)}
        placeholder="Pesquisar por nome ou símbolo…"
        className="flex-1 min-w-[180px] bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm placeholder:text-[var(--text-faint)] focus-ring outline-none"
      />

      <select
        value={value.chain}
        onChange={(e) => set("chain", e.target.value as BlockchainFilter)}
        className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm focus-ring outline-none"
      >
        <option value="all">Todas as blockchains</option>
        {CHAINS.map((c) => (
          <option key={c} value={c}>
            {CHAIN_LABEL[c]}
          </option>
        ))}
      </select>

      <select
        value={value.tier}
        onChange={(e) => set("tier", e.target.value as RiskFilter)}
        className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm focus-ring outline-none"
      >
        <option value="all">Todos os níveis de risco</option>
        {TIERS.map((t) => (
          <option key={t} value={t}>
            {TIER_META[t].label}
          </option>
        ))}
      </select>

      <select
        value={value.minMarketCap}
        onChange={(e) => set("minMarketCap", Number(e.target.value))}
        className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm focus-ring outline-none"
      >
        <option value={0}>Cap. mínima: qualquer</option>
        <option value={1_000_000}>≥ $1M</option>
        <option value={10_000_000}>≥ $10M</option>
        <option value={100_000_000}>≥ $100M</option>
        <option value={1_000_000_000}>≥ $1B</option>
      </select>

      <select
        value={value.minLiquidity}
        onChange={(e) => set("minLiquidity", Number(e.target.value))}
        className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm focus-ring outline-none"
      >
        <option value={0}>Liquidez mínima: qualquer</option>
        <option value={100_000}>≥ $100k</option>
        <option value={1_000_000}>≥ $1M</option>
        <option value={10_000_000}>≥ $10M</option>
      </select>

      <label className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value.watchlistOnly}
          onChange={(e) => set("watchlistOnly", e.target.checked)}
          className="accent-[var(--accent-opportunity)]"
        />
        Só watchlist
      </label>
    </div>
  );
}
