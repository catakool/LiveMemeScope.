"use client";

import { CoinRecord, CoinScores } from "@/lib/types";
import { formatUsd, formatPercent } from "@/lib/format";

export default function TickerTape({ records }: { records: (CoinRecord & { scores: CoinScores })[] }) {
  if (records.length === 0) return null;
  const items = [...records, ...records]; // duplica para o loop de scroll ficar contínuo

  return (
    <div className="relative overflow-hidden border-y border-[var(--border)] bg-[var(--surface)] py-2">
      <div className="flex w-max gap-8 animate-ticker px-4">
        {items.map((r, i) => {
          const change = r.market?.change24h ?? null;
          const color = change === null ? "text-[var(--text-faint)]" : change >= 0 ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-risk)]";
          return (
            <div key={`${r.def.coingeckoId}-${i}`} className="flex items-center gap-2 text-sm font-data whitespace-nowrap">
              <span className="text-[var(--text-muted)] font-semibold">{r.def.symbol}</span>
              <span>{formatUsd(r.market?.price ?? null)}</span>
              <span className={color}>{formatPercent(change)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
