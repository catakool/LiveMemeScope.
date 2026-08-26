"use client";

import { useEffect, useState } from "react";
import { DiscoveryRecord } from "@/lib/discovery";
import type { MonitorHealth } from "@/lib/storage/types";
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

function monitorAgeLabel(lastRunAt: string | null): string | null {
  if (!lastRunAt) return null;
  const ageMs = Date.now() - new Date(lastRunAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes} min`;
  return `há ${Math.floor(minutes / 60)} h`;
}

export default function LiveOpportunities({
  records,
  onOpen,
  monitorHealth,
  storageKind,
}: {
  records: DiscoveryRecord[];
  onOpen: (id: string) => void;
  monitorHealth?: MonitorHealth | null;
  storageKind?: "redis" | "memory";
}) {
  const [monitorStatus, setMonitorStatus] = useState<{ label: string | null; live: boolean }>({
    label: null,
    live: false,
  });

  useEffect(() => {
    const update = () => {
      const label = monitorAgeLabel(monitorHealth?.lastRunAt ?? null);
      let live = false;
      if (monitorHealth) {
        const ageMs = Date.now() - new Date(monitorHealth.lastRunAt).getTime();
        live = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 10 * 60_000;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- estado de frescura depende do relógio do browser e é atualizado periodicamente
      setMonitorStatus({ label, live });
    };
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [monitorHealth]);

  return (
    <div className="rounded-2xl border border-[var(--accent-gold)]/30 bg-gradient-to-b from-[var(--accent-gold)]/5 to-transparent p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🚨</span>
          <div>
            <h2 className="font-display font-bold text-base">Live Opportunities</h2>
            <p className="text-[10px] text-[var(--text-faint)]">
              {records.length} oportunidade{records.length === 1 ? "" : "s"} ativa{records.length === 1 ? "" : "s"} agora
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className={`rounded-full border px-2 py-1 ${
            monitorStatus.live
              ? "border-[var(--accent-opportunity)]/40 text-[var(--accent-opportunity)]"
              : "border-[var(--accent-gold)]/40 text-[var(--accent-gold)]"
          }`}>
            {monitorStatus.live ? "● Monitor LIVE" : "○ Monitor a aguardar"}
          </span>
          <span className="rounded-full border border-[var(--border)] px-2 py-1 text-[var(--text-muted)]">
            {storageKind === "redis" ? "Redis conectado" : storageKind === "memory" ? "Memória temporária" : "Storage N/D"}
          </span>
          {monitorStatus.label && (
            <span className="text-[var(--text-faint)]">último scan {monitorStatus.label}</span>
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Esta secção identifica condições de mercado que historicamente podem associar-se a momentum. Não prevê o
        futuro nem garante lucros — são apenas condições atuais, com as razões explicadas em cada cartão.
      </p>

      {records.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)]/60 p-4">
          <p className="text-sm font-medium">Nenhuma oportunidade forte neste momento.</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            O motor continua a monitorizar o mercado. No início, precisa de acumular snapshots suficientes para confirmar
            aceleração de preço, anomalia de volume e qualidade de liquidez antes de promover uma moeda para esta secção.
          </p>
          {monitorHealth && (
            <p className="mt-2 text-[10px] text-[var(--text-faint)]">
              Último ciclo: {monitorHealth.tokensProcessed} tokens processados · {monitorHealth.snapshotsSaved} snapshots guardados · {monitorHealth.apiFailures} falhas de API.
            </p>
          )}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {records.map((r) => (
            <OpportunityCard key={r.def.tokenKey} record={r} onOpen={() => onOpen(r.def.tokenKey)} />
          ))}
        </div>
      )}
    </div>
  );
}
