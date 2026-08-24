"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SourceMeta } from "@/lib/types";
import type { MonitorHealth } from "@/lib/storage/types";
import { DiscoveryRecord } from "@/lib/discovery";
import { evaluateAlerts } from "@/lib/alerts";

export interface CoinsApiResponse {
  records: DiscoveryRecord[];
  liveOpportunities: DiscoveryRecord[];
  universeSize: number;
  generatedAt: string;
  meta: { coingecko: SourceMeta };
  storage?: "redis" | "memory";
  monitorHealth?: MonitorHealth | null;
  error?: string;
}

const POLL_MS = 45_000;

export function useCoins() {
  const [data, setData] = useState<CoinsApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/coins", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const json = (await res.json()) as CoinsApiResponse;
      setData(json);
      setError(null);
      try {
        evaluateAlerts(json.records);
      } catch {
        // a avaliação de alertas nunca deve derrubar o carregamento de dados
      }
    } catch {
      setError("Não foi possível contactar as fontes de dados. A mostrar a última informação disponível.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- inicia o polling; load() atualiza estado a partir de uma fonte externa (a API)
    load();
    timerRef.current = setInterval(load, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  return { data, error, loading, refresh: load };
}
