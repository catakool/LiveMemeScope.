"use client";

import { AlertEvent, AlertMetric, AlertRule } from "./types";
import { DiscoveryRecord } from "./discovery";
import { OpportunityClassification } from "./opportunity";

const RULES_KEY = "memescope:alert-rules:v1";
const EVENTS_KEY = "memescope:alert-events:v1";
const LAST_VALUES_KEY = "memescope:alert-lastvalues:v1";

export function getAlertRules(): AlertRule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RULES_KEY);
    return raw ? (JSON.parse(raw) as AlertRule[]) : [];
  } catch {
    return [];
  }
}

export function saveAlertRule(rule: AlertRule): AlertRule[] {
  const rules = getAlertRules();
  const next = [...rules, rule];
  window.localStorage.setItem(RULES_KEY, JSON.stringify(next));
  return next;
}

export function deleteAlertRule(id: string): AlertRule[] {
  const next = getAlertRules().filter((r) => r.id !== id);
  window.localStorage.setItem(RULES_KEY, JSON.stringify(next));
  return next;
}

export function toggleAlertRule(id: string): AlertRule[] {
  const next = getAlertRules().map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
  window.localStorage.setItem(RULES_KEY, JSON.stringify(next));
  return next;
}

export function getAlertEvents(): AlertEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(EVENTS_KEY);
    return raw ? (JSON.parse(raw) as AlertEvent[]) : [];
  } catch {
    return [];
  }
}

function pushEvent(event: AlertEvent) {
  const events = [event, ...getAlertEvents()].slice(0, 200);
  window.localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

function getLastValues(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LAST_VALUES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setLastValues(values: Record<string, number>) {
  window.localStorage.setItem(LAST_VALUES_KEY, JSON.stringify(values));
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission === "default") {
    return Notification.requestPermission();
  }
  return Notification.permission;
}

function notify(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: undefined });
  }
}

function metricLabel(m: AlertMetric): string {
  switch (m) {
    case "price_above":
      return "Preço acima de";
    case "price_below":
      return "Preço abaixo de";
    case "volume_increase_pct":
      return "Aumento de volume superior a";
    case "liquidity_above":
      return "Liquidez acima de";
    case "liquidity_below":
      return "Liquidez abaixo de";
    case "liquidity_drop_pct":
      return "Queda de liquidez superior a";
    case "opportunity_score_change":
      return "Alteração no Opportunity Score superior a";
    case "risk_score_above":
      return "Risk Score acima de";
    case "whale_movement":
      return "Movimentação anormal de grandes detentores";
    case "opportunity_signal":
      return "Nova sinal do Opportunity Engine (Watch ou superior)";
  }
}

const OPPORTUNITY_TIER_RANK: Record<OpportunityClassification, number> = {
  no_signal: 0,
  watch: 1,
  high_momentum_watch: 2,
  strong_opportunity: 3,
  very_strong_opportunity: 4,
};

/**
 * Avalia todas as regras ativas contra os dados mais recentes.
 * Corre inteiramente no browser: não há execução de transações nem ligação de carteiras.
 */
export function evaluateAlerts(records: DiscoveryRecord[]): AlertEvent[] {
  const rules = getAlertRules().filter((r) => r.enabled);
  if (rules.length === 0) return [];

  const lastValues = getLastValues();
  const newEvents: AlertEvent[] = [];
  const nextLastValues = { ...lastValues };

  for (const rule of rules) {
    const record = records.find((r) => r.def.coingeckoId === rule.coinId);
    if (!record) continue;

    let triggered = false;
    let message = "";
    const lastKey = `${rule.id}`;

    switch (rule.metric) {
      case "price_above":
        if (record.market?.price !== null && record.market?.price !== undefined && record.market.price > rule.threshold) {
          triggered = true;
          message = `${record.def.symbol}: preço ultrapassou $${rule.threshold}.`;
        }
        break;
      case "price_below":
        if (record.market?.price !== null && record.market?.price !== undefined && record.market.price < rule.threshold) {
          triggered = true;
          message = `${record.def.symbol}: preço caiu abaixo de $${rule.threshold}.`;
        }
        break;
      case "volume_increase_pct": {
        const vol = record.market?.volume24h ?? null;
        const prev = lastValues[`vol:${rule.coinId}`];
        if (vol !== null && prev && prev > 0) {
          const changePct = ((vol - prev) / prev) * 100;
          if (changePct > rule.threshold) {
            triggered = true;
            message = `${record.def.symbol}: volume subiu ${changePct.toFixed(1)}% desde a última verificação.`;
          }
        }
        if (vol !== null) nextLastValues[`vol:${rule.coinId}`] = vol;
        break;
      }
      case "liquidity_above":
        if (record.dex?.liquidityUsd !== null && record.dex?.liquidityUsd !== undefined && record.dex.liquidityUsd > rule.threshold) {
          triggered = true;
          message = `${record.def.symbol}: liquidez acima de $${rule.threshold}.`;
        }
        break;
      case "liquidity_below":
        if (record.dex?.liquidityUsd !== null && record.dex?.liquidityUsd !== undefined && record.dex.liquidityUsd < rule.threshold) {
          triggered = true;
          message = `${record.def.symbol}: liquidez abaixo de $${rule.threshold}.`;
        }
        break;
      case "liquidity_drop_pct": {
        const liq = record.dex?.liquidityUsd ?? null;
        const prev = lastValues[`liq:${rule.coinId}`];
        if (liq !== null && prev && prev > 0) {
          const dropPct = ((prev - liq) / prev) * 100;
          if (dropPct > rule.threshold) {
            triggered = true;
            message = `${record.def.symbol}: liquidez caiu ${dropPct.toFixed(1)}% desde a última verificação.`;
          }
        }
        if (liq !== null) nextLastValues[`liq:${rule.coinId}`] = liq;
        break;
      }
      case "opportunity_score_change": {
        const score = record.scores.opportunity.score;
        const prev = lastValues[`opp:${rule.coinId}`];
        if (score !== null && prev !== undefined && Math.abs(score - prev) > rule.threshold) {
          triggered = true;
          message = `${record.def.symbol}: Opportunity Score mudou ${(score - prev).toFixed(1)} pontos.`;
        }
        if (score !== null) nextLastValues[`opp:${rule.coinId}`] = score;
        break;
      }
      case "risk_score_above": {
        const score = record.scores.risk.score;
        if (score !== null && score > rule.threshold) {
          triggered = true;
          message = `${record.def.symbol}: Risk Score em ${score.toFixed(0)}, acima do limite de ${rule.threshold}.`;
        }
        break;
      }
      case "whale_movement":
        // Sem fonte de dados de carteiras integrada nesta versão — a regra fica registada mas nunca dispara sozinha.
        break;
      case "opportunity_signal": {
        const opp = record.opportunity;
        if (opp && opp.classification !== "no_signal") {
          const rank = OPPORTUNITY_TIER_RANK[opp.classification];
          const lastRank = lastValues[`opp-tier:${rule.coinId}`] ?? -1;
          // Só dispara quando o nível SOBE face ao último conhecido — evita repetir a cada polling (ex.: 84 -> 85).
          if (rank > lastRank) {
            triggered = true;
            message = `${record.def.symbol}: ${opp.classification.replace(/_/g, " ")} (score ${opp.total ?? "N/D"}).`;
          }
          nextLastValues[`opp-tier:${rule.coinId}`] = rank;
        }
        break;
      }
    }

    if (triggered) {
      const event: AlertEvent = {
        id: `${rule.id}-${Date.now()}`,
        ruleId: rule.id,
        coinId: rule.coinId,
        message,
        triggeredAt: new Date().toISOString(),
      };
      newEvents.push(event);
      pushEvent(event);
      notify("MemeScope", message);
    }

    void lastKey;
  }

  setLastValues(nextLastValues);
  return newEvents;
}

export { metricLabel };
