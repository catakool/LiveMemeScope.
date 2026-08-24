"use client";

import { useEffect, useState } from "react";
import { CoinScores, DexPairData, MarketData, TokenDefinition, SourceMeta } from "@/lib/types";
import { MarketChart } from "@/lib/coingecko";
import { OpportunityResult } from "@/lib/opportunity";
import { StoredSignal } from "@/lib/storage";
import { formatUsd, formatPercent, formatDateTime } from "@/lib/format";
import { TIER_META, CHAIN_LABEL } from "@/lib/tiers";
import PriceChart from "./PriceChart";
import PriceVolumeChart from "./PriceVolumeChart";
import RiskRadar from "./RiskRadar";
import ScoreBreakdown from "./ScoreBreakdown";
import DataStatusBadge from "./DataStatusBadge";
import Disclaimer from "./Disclaimer";
import OpportunityBadge from "./OpportunityBadge";

interface DetailResponse {
  def: TokenDefinition;
  market: MarketData | null;
  dex: DexPairData | null;
  chart: MarketChart | null;
  scores: CoinScores;
  opportunity: OpportunityResult | null;
  signals: StoredSignal[];
  meta: { coingecko: SourceMeta; dexscreener: SourceMeta; chart: SourceMeta };
}

const RANGES = [
  { label: "7d", days: "7" },
  { label: "30d", days: "30" },
  { label: "90d", days: "90" },
  { label: "1a", days: "365" },
];

export default function CoinDetailModal({ coinId, onClose }: { coinId: string; onClose: () => void }) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- inicia o fetch ao mudar de moeda/intervalo; o resultado chega no callback
    setLoading(true);
    fetch(`/api/coins/${coinId}?days=${days}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [coinId, days]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 sm:p-8">
      <div className="w-full max-w-4xl rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="font-display font-semibold text-lg">
              {data?.def.name ?? coinId} <span className="text-[var(--text-muted)] font-data text-sm">{data?.def.symbol}</span>
            </h2>
            {data && (
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full border"
                  style={{ color: TIER_META[data.def.riskTier].color, borderColor: TIER_META[data.def.riskTier].color + "55" }}
                >
                  {TIER_META[data.def.riskTier].label}
                </span>
                <span className="text-[10px] text-[var(--text-faint)]">{CHAIN_LABEL[data.def.chain]}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl focus-ring" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Disclaimer compact />

          {loading && <p className="text-sm text-[var(--text-muted)]">A carregar dados…</p>}

          {data && (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <span className="font-data text-2xl font-semibold">{formatUsd(data.market?.price ?? null)}</span>
                <span className={`font-data text-sm ${(data.market?.change24h ?? 0) >= 0 ? "text-[var(--accent-opportunity)]" : "text-[var(--accent-risk)]"}`}>
                  {formatPercent(data.market?.change24h ?? null)} (24h)
                </span>
                <DataStatusBadge meta={data.meta.coingecko} label="CoinGecko" />
                <DataStatusBadge meta={data.meta.dexscreener} label="DexScreener" />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-2.5">
                  <div className="text-[var(--text-faint)]">Capitalização</div>
                  <div className="font-data text-sm">{formatUsd(data.market?.marketCap ?? null, { compact: true })}</div>
                </div>
                <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-2.5">
                  <div className="text-[var(--text-faint)]">FDV</div>
                  <div className="font-data text-sm">{formatUsd(data.market?.fdv ?? null, { compact: true })}</div>
                </div>
                <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-2.5">
                  <div className="text-[var(--text-faint)]">Volume 24h</div>
                  <div className="font-data text-sm">{formatUsd(data.market?.volume24h ?? null, { compact: true })}</div>
                </div>
                <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-2.5">
                  <div className="text-[var(--text-faint)]">Liquidez (DEX)</div>
                  <div className="font-data text-sm">
                    {data.dex?.liquidityUsd !== null && data.dex?.liquidityUsd !== undefined
                      ? formatUsd(data.dex.liquidityUsd, { compact: true })
                      : "N/D"}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-display font-semibold text-sm">Histórico de preço</h3>
                  <div className="flex gap-1">
                    {RANGES.map((r) => (
                      <button
                        key={r.days}
                        onClick={() => setDays(r.days)}
                        className={`text-xs px-2 py-1 rounded-md border ${
                          days === r.days
                            ? "border-[var(--accent-opportunity)] text-[var(--accent-opportunity)]"
                            : "border-[var(--border)] text-[var(--text-muted)]"
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
                  <PriceChart prices={data.chart?.prices ?? []} />
                </div>
              </div>

              <div>
                <h3 className="font-display font-semibold text-sm mb-2">Preço vs. volume</h3>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
                  <PriceVolumeChart chart={data.chart} />
                </div>
              </div>

              {data.opportunity && data.opportunity.total !== null ? (
                <div className="rounded-xl border border-[var(--accent-gold)]/40 bg-[var(--surface)] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display font-semibold text-sm">Opportunity Engine</h3>
                    <div className="flex items-center gap-2">
                      <span className="font-data text-lg font-bold text-[var(--accent-gold)]">{data.opportunity.total}/100</span>
                      <OpportunityBadge classification={data.opportunity.classification} />
                    </div>
                  </div>
                  <p className="text-xs text-[var(--text-faint)]">
                    Confiança: {(data.opportunity.confidence * 100).toFixed(0)}%. Identifica condições de mercado que
                    historicamente podem associar-se a momentum — não prevê o futuro nem garante lucros.
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-[var(--text-faint)]">5m</span>
                      <div className="font-data">{formatPercent(data.opportunity.metrics.change5m)}</div>
                    </div>
                    <div>
                      <span className="text-[var(--text-faint)]">15m</span>
                      <div className="font-data">{formatPercent(data.opportunity.metrics.change15m)}</div>
                    </div>
                    <div>
                      <span className="text-[var(--text-faint)]">1h</span>
                      <div className="font-data">{formatPercent(data.opportunity.metrics.change1h)}</div>
                    </div>
                  </div>
                  {data.opportunity.reasons.length > 0 && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Why now?</span>
                      <ul className="mt-1 space-y-0.5">
                        {data.opportunity.reasons.map((r, i) => (
                          <li key={i} className="text-xs text-[var(--text-muted)]">
                            • {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {data.opportunity.risks.length > 0 && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wide text-[var(--accent-risk)]">Risk</span>
                      <ul className="mt-1 space-y-0.5">
                        {data.opportunity.risks.map((r, i) => (
                          <li key={i} className="text-xs text-[var(--accent-risk)]">
                            • {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--text-muted)]">
                  Opportunity Engine: ainda sem histórico suficiente para esta moeda. O job de monitorização precisa de
                  acumular alguns snapshots antes de conseguir calcular aceleração.
                </div>
              )}

              {data.signals.length > 0 && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <h3 className="font-display font-semibold text-sm mb-2">Histórico de sinais</h3>
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                    {data.signals.map((s) => (
                      <li key={s.id} className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-muted)]">{formatDateTime(s.timestamp)}</span>
                        <OpportunityBadge classification={s.classification} />
                        <span className="font-data">{s.opportunityScore ?? "N/D"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                <ScoreBreakdown title="Opportunity Score (Discovery)" result={data.scores.opportunity} accent="var(--accent-opportunity)" />
                <ScoreBreakdown title="Risk Score" result={data.scores.risk} accent="var(--accent-risk)" />
              </div>

              <RiskRadar risk={data.scores.risk} />

              {data.def.note && (
                <p className="text-xs text-[var(--accent-gold)] border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)]">
                  {data.def.note}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
