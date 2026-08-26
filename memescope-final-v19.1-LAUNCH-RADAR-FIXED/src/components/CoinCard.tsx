"use client";

import { CoinRecord, CoinScores, DiscoveryReason } from "@/lib/types";
import { formatUsd, formatPercent, formatCompactNumber } from "@/lib/format";
import { TIER_META, CHAIN_LABEL } from "@/lib/tiers";
import ScoreGauge from "./ScoreGauge";
import DataStatusBadge from "./DataStatusBadge";

const REASON_META: Record<DiscoveryReason, { label: string; color: string }> = {
  trending: { label: "Em tendência", color: "var(--accent-gold)" },
  momentum: { label: "Momentum", color: "var(--accent-opportunity)" },
  new_pair: { label: "Par novo", color: "var(--accent-info)" },
};

function ChangeStat({ label, value }: { label: string; value: number | null }) {
  const color =
    value === null ? "text-[var(--text-faint)]" : value >= 0 ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-risk)]";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">{label}</span>
      <span className={`font-data text-xs ${color}`}>{formatPercent(value)}</span>
    </div>
  );
}

export default function CoinCard({
  record,
  starred,
  onToggleStar,
  onOpen,
  reasons,
}: {
  record: CoinRecord & { scores: CoinScores };
  starred: boolean;
  onToggleStar: () => void;
  onOpen: () => void;
  reasons?: DiscoveryReason[];
}) {
  const { def, market, dex, meta, scores } = record;
  const tier = TIER_META[def.riskTier];

  return (
    <div
      className="group relative rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-[var(--accent-opportunity)]/40 transition-colors cursor-pointer"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
    >
      <button
        aria-label={starred ? "Remover da watchlist" : "Adicionar à watchlist"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleStar();
        }}
        className="absolute top-3 right-3 text-lg leading-none focus-ring"
      >
        <span className={starred ? "text-[var(--accent-gold)]" : "text-[var(--text-faint)] group-hover:text-[var(--text-muted)]"}>
          {starred ? "★" : "☆"}
        </span>
      </button>

      <div className="flex items-start gap-3">
        <ScoreGauge
          opportunity={scores.opportunity.score}
          risk={scores.risk.score}
          opportunityConfidence={scores.opportunity.confidence}
          riskConfidence={scores.risk.confidence}
          size={64}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-[15px] truncate">{def.name}</span>
            <span className="font-data text-xs text-[var(--text-muted)]">{def.symbol}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full border"
              style={{ color: tier.color, borderColor: tier.color + "55" }}
            >
              {tier.label}
            </span>
            <span className="text-[10px] text-[var(--text-faint)]">{CHAIN_LABEL[def.chain]}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${market ? "border-[var(--accent-opportunity)]/35 text-[var(--accent-opportunity)]" : "border-[var(--accent-info)]/35 text-[var(--accent-info)]"}`}>
              Source: {market ? "CoinGecko" : "DexScreener"}
            </span>
          </div>
          {reasons && reasons.length > 0 && (
            <div className="mt-1 flex items-center gap-1 flex-wrap">
              {reasons.map((r) => (
                <span
                  key={r}
                  className="text-[9px] px-1.5 py-0.5 rounded-full"
                  style={{ background: REASON_META[r].color + "22", color: REASON_META[r].color }}
                >
                  {REASON_META[r].label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-data text-xl font-semibold">{formatUsd(market?.price ?? null)}</span>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-2">
        <ChangeStat label="1h" value={market?.change1h ?? null} />
        <ChangeStat label="24h" value={market?.change24h ?? null} />
        <ChangeStat label="7d" value={market?.change7d ?? null} />
        <ChangeStat label="30d" value={market?.change30d ?? null} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
        <div className="flex justify-between">
          <span>Cap.</span>
          <span className="font-data">{formatUsd(market?.marketCap ?? null, { compact: true })}</span>
        </div>
        <div className="flex justify-between">
          <span>FDV</span>
          <span className="font-data">{formatUsd(market?.fdv ?? null, { compact: true })}</span>
        </div>
        <div className="flex justify-between">
          <span>Volume 24h</span>
          <span className="font-data">{formatUsd(market?.volume24h ?? null, { compact: true })}</span>
        </div>
        <div className="flex justify-between">
          <span>Liquidez</span>
          <span className="font-data">
            {dex?.liquidityUsd !== null && dex?.liquidityUsd !== undefined
              ? formatUsd(dex.liquidityUsd, { compact: true })
              : "N/D"}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2">
        <DataStatusBadge meta={meta.coingecko} />
        <span className="text-[10px] text-[var(--text-faint)]">
          {formatCompactNumber(market?.circulatingSupply ?? null)} {def.symbol}
        </span>
      </div>
    </div>
  );
}
