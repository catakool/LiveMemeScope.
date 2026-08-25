"use client";

import { useMemo, useState } from "react";
import { CoinRecord, CoinScores } from "@/lib/types";
import { formatUsd, formatPercent } from "@/lib/format";
import { TIER_META } from "@/lib/tiers";

type SortKey =
  | "symbol"
  | "price"
  | "change1h"
  | "change24h"
  | "change7d"
  | "change30d"
  | "marketCap"
  | "fdv"
  | "volume24h"
  | "liquidity"
  | "opportunity"
  | "risk";

function getSortValue(r: CoinRecord & { scores: CoinScores }, key: SortKey): number {
  switch (key) {
    case "symbol":
      return r.def.symbol.charCodeAt(0);
    case "price":
      return r.market?.price ?? -Infinity;
    case "change1h":
      return r.market?.change1h ?? -Infinity;
    case "change24h":
      return r.market?.change24h ?? -Infinity;
    case "change7d":
      return r.market?.change7d ?? -Infinity;
    case "change30d":
      return r.market?.change30d ?? -Infinity;
    case "marketCap":
      return r.market?.marketCap ?? -Infinity;
    case "fdv":
      return r.market?.fdv ?? -Infinity;
    case "volume24h":
      return r.market?.volume24h ?? -Infinity;
    case "liquidity":
      return r.dex?.liquidityUsd ?? -Infinity;
    case "opportunity":
      return r.scores.opportunity.score ?? -Infinity;
    case "risk":
      return r.scores.risk.score ?? -Infinity;
  }
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "symbol", label: "Moeda" },
  { key: "price", label: "Preço" },
  { key: "change1h", label: "1h" },
  { key: "change24h", label: "24h" },
  { key: "change7d", label: "7d" },
  { key: "change30d", label: "30d" },
  { key: "marketCap", label: "Cap." },
  { key: "fdv", label: "FDV" },
  { key: "volume24h", label: "Volume 24h" },
  { key: "liquidity", label: "Liquidez" },
  { key: "opportunity", label: "Opportunity" },
  { key: "risk", label: "Risk" },
];

export default function CoinTable({
  records,
  onOpen,
}: {
  records: (CoinRecord & { scores: CoinScores })[];
  onOpen: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("marketCap");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const sorted = useMemo(() => {
    return [...records].sort((a, b) => (getSortValue(a, sortKey) - getSortValue(b, sortKey)) * sortDir);
  }, [records, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(-1);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                className="text-left px-3 py-2 text-xs text-[var(--text-faint)] font-normal cursor-pointer select-none hover:text-[var(--text-muted)] whitespace-nowrap"
              >
                {col.label} {sortKey === col.key ? (sortDir === 1 ? "↑" : "↓") : ""}
              </th>
            ))}
            <th className="text-left px-3 py-2 text-xs text-[var(--text-faint)] font-normal whitespace-nowrap">Source</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.def.tokenKey}
              onClick={() => onOpen(r.def.tokenKey)}
              className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)] cursor-pointer"
            >
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="font-data font-semibold">{r.def.symbol}</span>
                <span
                  className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full border"
                  style={{ color: TIER_META[r.def.riskTier].color, borderColor: TIER_META[r.def.riskTier].color + "55" }}
                >
                  {TIER_META[r.def.riskTier].label}
                </span>
              </td>
              <td className="px-3 py-2 font-data whitespace-nowrap">{formatUsd(r.market?.price ?? null)}</td>
              <td className="px-3 py-2 font-data whitespace-nowrap">{formatPercent(r.market?.change1h ?? null)}</td>
              <td className="px-3 py-2 font-data whitespace-nowrap">{formatPercent(r.market?.change24h ?? null)}</td>
              <td className="px-3 py-2 font-data whitespace-nowrap">{formatPercent(r.market?.change7d ?? null)}</td>
              <td className="px-3 py-2 font-data whitespace-nowrap">{formatPercent(r.market?.change30d ?? null)}</td>
              <td className="px-3 py-2 font-data whitespace-nowrap">{formatUsd(r.market?.marketCap ?? null, { compact: true })}</td>
              <td className="px-3 py-2 font-data whitespace-nowrap">{formatUsd(r.market?.fdv ?? null, { compact: true })}</td>
              <td className="px-3 py-2 font-data whitespace-nowrap">{formatUsd(r.market?.volume24h ?? null, { compact: true })}</td>
              <td className="px-3 py-2 font-data whitespace-nowrap">
                {r.dex?.liquidityUsd !== null && r.dex?.liquidityUsd !== undefined
                  ? formatUsd(r.dex.liquidityUsd, { compact: true })
                  : "N/D"}
              </td>
              <td className="px-3 py-2 font-data whitespace-nowrap text-[var(--accent-opportunity)]">
                {r.scores.opportunity.score ?? "N/D"}
              </td>
              <td className="px-3 py-2 font-data whitespace-nowrap text-[var(--accent-risk)]">
                {r.scores.risk.score ?? "N/D"}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${r.market ? "border-[var(--accent-opportunity)]/35 text-[var(--accent-opportunity)]" : "border-[var(--accent-info)]/35 text-[var(--accent-info)]"}`}>
                  {r.market ? "CoinGecko" : "DexScreener"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
