"use client";

import { CoinRecord, CoinScores } from "@/lib/types";
import { formatUsd, formatPercent } from "@/lib/format";

function StatBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--text-faint)] uppercase tracking-wide">{label}</span>
      <span className="font-data text-lg font-semibold">{value}</span>
      {sub && <span className="text-xs text-[var(--text-muted)]">{sub}</span>}
    </div>
  );
}

export default function MarketSummary({ records }: { records: (CoinRecord & { scores: CoinScores })[] }) {
  const totalMcap = records.reduce((a, r) => a + (r.market?.marketCap ?? 0), 0);
  const totalVolume = records.reduce((a, r) => a + (r.market?.volume24h ?? 0), 0);

  const withChange = records.filter((r) => r.market?.change24h !== null && r.market?.change24h !== undefined);
  const avgChange24h = withChange.length
    ? withChange.reduce((a, r) => a + (r.market!.change24h as number), 0) / withChange.length
    : null;

  const topMover = [...records].sort(
    (a, b) => (b.market?.change24h ?? -Infinity) - (a.market?.change24h ?? -Infinity)
  )[0];

  const highRiskCount = records.filter((r) => (r.scores.risk.score ?? 0) > 70).length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <StatBlock label="Capitalização acompanhada" value={formatUsd(totalMcap, { compact: true })} />
      <StatBlock label="Volume 24h acompanhado" value={formatUsd(totalVolume, { compact: true })} />
      <StatBlock
        label="Variação média 24h"
        value={formatPercent(avgChange24h)}
        sub={`${records.length} moedas acompanhadas`}
      />
      <StatBlock
        label="Maior variação 24h"
        value={topMover ? formatPercent(topMover.market?.change24h ?? null) : "N/D"}
        sub={topMover?.def.symbol}
      />
      <StatBlock label="Risk Score > 70" value={String(highRiskCount)} sub="tokens em condições de risco elevado" />
    </div>
  );
}
