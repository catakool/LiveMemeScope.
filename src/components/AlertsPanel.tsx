"use client";

import { useEffect, useState } from "react";
import { CoinRecord, CoinScores, AlertMetric, AlertRule, AlertEvent } from "@/lib/types";
import {
  getAlertRules,
  saveAlertRule,
  deleteAlertRule,
  toggleAlertRule,
  getAlertEvents,
  requestNotificationPermission,
  metricLabel,
} from "@/lib/alerts";
import { timeAgo } from "@/lib/format";

const METRICS: { value: AlertMetric; label: string; unit: string }[] = [
  { value: "price_above", label: "Preço acima de", unit: "USD" },
  { value: "price_below", label: "Preço abaixo de", unit: "USD" },
  { value: "volume_increase_pct", label: "Aumento de volume superior a", unit: "%" },
  { value: "liquidity_above", label: "Liquidez acima de", unit: "USD" },
  { value: "liquidity_below", label: "Liquidez abaixo de", unit: "USD" },
  { value: "liquidity_drop_pct", label: "Queda de liquidez superior a", unit: "%" },
  { value: "opportunity_score_change", label: "Alteração no Opportunity Score superior a", unit: "pontos" },
  { value: "risk_score_above", label: "Risk Score superior a", unit: "pontos" },
  { value: "whale_movement", label: "Movimentação anormal de grandes detentores", unit: "" },
];

export default function AlertsPanel({ records }: { records: (CoinRecord & { scores: CoinScores })[] }) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [coinId, setCoinId] = useState(records[0]?.def.coingeckoId ?? "");
  const [metric, setMetric] = useState<AlertMetric>("price_above");
  const [threshold, setThreshold] = useState<number>(0);
  const [notifStatus, setNotifStatus] = useState<NotificationPermission>("default");

  useEffect(() => {
    setRules(getAlertRules());
    setEvents(getAlertEvents());
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifStatus(Notification.permission);
    }
    const interval = setInterval(() => setEvents(getAlertEvents()), 10_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!coinId && records[0]) setCoinId(records[0].def.coingeckoId);
  }, [records, coinId]);

  const addRule = () => {
    if (!coinId) return;
    const rule: AlertRule = {
      id: crypto.randomUUID(),
      coinId,
      metric,
      threshold,
      createdAt: new Date().toISOString(),
      enabled: true,
    };
    setRules(saveAlertRule(rule));
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold text-sm">Alertas</h3>
        <button
          onClick={async () => setNotifStatus(await requestNotificationPermission())}
          className="text-xs px-2 py-1 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] focus-ring"
        >
          {notifStatus === "granted" ? "Notificações ativas" : "Ativar notificações do navegador"}
        </button>
      </div>

      <div className="grid sm:grid-cols-4 gap-2">
        <select
          value={coinId}
          onChange={(e) => setCoinId(e.target.value)}
          className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm focus-ring outline-none"
        >
          {records.map((r) => (
            <option key={r.def.coingeckoId} value={r.def.coingeckoId}>
              {r.def.symbol}
            </option>
          ))}
        </select>
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value as AlertMetric)}
          className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm focus-ring outline-none sm:col-span-2"
        >
          {METRICS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm focus-ring outline-none"
            disabled={metric === "whale_movement"}
          />
          <button
            onClick={addRule}
            className="px-3 py-1.5 rounded-lg bg-[var(--accent-opportunity)] text-[#062421] text-sm font-medium whitespace-nowrap focus-ring"
          >
            Criar
          </button>
        </div>
      </div>

      <div>
        <h4 className="text-xs text-[var(--text-faint)] uppercase tracking-wide mb-1.5">Regras ativas</h4>
        {rules.length === 0 && <p className="text-xs text-[var(--text-muted)]">Ainda não criou nenhum alerta.</p>}
        <ul className="space-y-1.5">
          {rules.map((r) => {
            const coin = records.find((rec) => rec.def.coingeckoId === r.coinId);
            return (
              <li
                key={r.id}
                className="flex items-center justify-between text-xs bg-[var(--surface-2)] rounded-lg px-2.5 py-1.5"
              >
                <span className={r.enabled ? "" : "opacity-40"}>
                  <span className="font-data font-semibold">{coin?.def.symbol ?? r.coinId}</span> ·{" "}
                  {metricLabel(r.metric)} {r.metric !== "whale_movement" ? r.threshold : ""}
                </span>
                <span className="flex items-center gap-2">
                  <button
                    onClick={() => setRules(toggleAlertRule(r.id))}
                    className="text-[var(--text-muted)] hover:text-[var(--text)] focus-ring"
                  >
                    {r.enabled ? "Pausar" : "Retomar"}
                  </button>
                  <button
                    onClick={() => setRules(deleteAlertRule(r.id))}
                    className="text-[var(--accent-risk)] hover:opacity-80 focus-ring"
                  >
                    Remover
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h4 className="text-xs text-[var(--text-faint)] uppercase tracking-wide mb-1.5">Eventos recentes</h4>
        {events.length === 0 && <p className="text-xs text-[var(--text-muted)]">Sem eventos disparados ainda.</p>}
        <ul className="space-y-1 max-h-40 overflow-y-auto">
          {events.slice(0, 10).map((e) => (
            <li key={e.id} className="text-xs text-[var(--text-muted)]">
              <span className="text-[var(--text-faint)] font-data">{timeAgo(e.triggeredAt)}</span> — {e.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
