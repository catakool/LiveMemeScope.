"use client";

import { CoinRecord, CoinScores } from "@/lib/types";
import { formatPercent } from "@/lib/format";

const TIMEFRAMES: { key: "change1h" | "change24h" | "change7d" | "change30d"; label: string; cap: number }[] = [
  { key: "change1h", label: "1h", cap: 8 },
  { key: "change24h", label: "24h", cap: 25 },
  { key: "change7d", label: "7d", cap: 60 },
  { key: "change30d", label: "30d", cap: 150 },
];

function cellColor(value: number | null, cap: number): string {
  if (value === null) return "var(--surface-2)";
  const intensity = Math.min(1, Math.abs(value) / cap);
  const alpha = 0.15 + intensity * 0.65;
  return value >= 0 ? `rgba(94, 234, 212, ${alpha})` : `rgba(251, 113, 133, ${alpha})`;
}

export default function MomentumHeatmap({ records }: { records: (CoinRecord & { scores: CoinScores })[] }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="font-display font-semibold text-sm mb-3">Heatmap de momentum</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="text-left text-[var(--text-faint)] font-normal pl-1">Moeda</th>
              {TIMEFRAMES.map((tf) => (
                <th key={tf.key} className="text-[var(--text-faint)] font-normal px-2">
                  {tf.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.def.coingeckoId}>
                <td className="pl-1 py-1 text-[var(--text-muted)] font-data whitespace-nowrap">{r.def.symbol}</td>
                {TIMEFRAMES.map((tf) => {
                  const value = r.market?.[tf.key] ?? null;
                  return (
                    <td key={tf.key} className="p-0">
                      <div
                        className="w-16 h-8 rounded-md flex items-center justify-center font-data"
                        style={{ background: cellColor(value, tf.cap) }}
                        title={`${r.def.symbol} ${tf.label}: ${formatPercent(value)}`}
                      >
                        {value === null ? "–" : formatPercent(value)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
