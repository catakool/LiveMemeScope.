"use client";

import { DiscoveryRecord } from "@/lib/discovery";
import { formatUsd, formatPercent } from "@/lib/format";
import OpportunityBadge from "./OpportunityBadge";

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">{label}</span>
      <span className="font-data text-sm font-semibold">{value}</span>
    </div>
  );
}

function OpportunityCard({ record, onOpen }: { record: DiscoveryRecord; onOpen: () => void }) {
  const opp = record.opportunity;
  if (!opp || opp.total === null) return null;

  return (
    <div
      className="rounded-xl border border-[var(--accent-gold)]/40 bg-[var(--surface)] p-4 cursor-pointer hover:border-[var(--accent-gold)] transition-colors"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-base">{record.def.name}</span>
            <span className="font-data text-xs text-[var(--text-muted)]">{record.def.symbol}</span>
          </div>
          <OpportunityBadge classification={opp.classification} size="md" />
        </div>
        <div className="text-right">
          <div className="font-data text-2xl font-bold text-[var(--accent-gold)]">{opp.total}/100</div>
          <div className="text-[10px] text-[var(--text-faint)]">confiança {(opp.confidence * 100).toFixed(0)}%</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricBlock label="Market Cap" value={formatUsd(record.market?.marketCap ?? null, { compact: true })} />
        <MetricBlock label="5m" value={formatPercent(opp.metrics.change5m)} />
        <MetricBlock label="15m" value={formatPercent(opp.metrics.change15m)} />
        <MetricBlock label="1h" value={formatPercent(opp.metrics.change1h)} />
        <MetricBlock
          label="Volume acceleration"
          value={opp.metrics.volumeRatio !== null ? `${opp.metrics.volumeRatio}x` : "N/D"}
        />
        <MetricBlock label="Buy/Sell" value={opp.metrics.buySellRatio !== null ? `${(opp.metrics.buySellRatio * 100).toFixed(0)}%` : "N/D"} />
        <MetricBlock label="Liquidez" value={formatUsd(record.dex?.liquidityUsd ?? null, { compact: true })} />
        <MetricBlock label="Preço" value={formatUsd(record.market?.price ?? record.dex?.priceUsd ?? null)} />
      </div>

      {opp.reasons.length > 0 && (
        <div className="mt-3">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Why now?</span>
          <ul className="mt-1 space-y-0.5">
            {opp.reasons.map((r, i) => (
              <li key={i} className="text-xs text-[var(--text-muted)]">
                • {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {opp.risks.length > 0 && (
        <div className="mt-2">
          <span className="text-[10px] uppercase tracking-wide text-[var(--accent-risk)]">Risk</span>
          <ul className="mt-1 space-y-0.5">
            {opp.risks.map((r, i) => (
              <li key={i} className="text-xs text-[var(--accent-risk)]">
                • {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function LiveOpportunities({
  records,
  onOpen,
}: {
  records: DiscoveryRecord[];
  onOpen: (id: string) => void;
}) {
  if (records.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[var(--accent-gold)]/30 bg-gradient-to-b from-[var(--accent-gold)]/5 to-transparent p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">🚨</span>
        <h2 className="font-display font-bold text-base">Live Opportunities</h2>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Esta secção identifica condições de mercado que historicamente podem associar-se a momentum. Não prevê o
        futuro nem garante lucros — são apenas condições atuais, com as razões explicadas em cada cartão.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {records.map((r) => (
          <OpportunityCard key={r.def.tokenKey} record={r} onOpen={() => onOpen(r.def.tokenKey)} />
        ))}
      </div>
    </div>
  );
}
