"use client";

import { useEffect, useState } from "react";
import { SourceMeta } from "@/lib/types";
import type { MonitorHealth } from "@/lib/storage/types";
import DataStatusBadge from "./DataStatusBadge";

function timeAgoShort(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "agora mesmo";
  if (m < 60) return `há ${m}min`;
  return `há ${Math.floor(m / 60)}h`;
}

export default function Header({
  generatedAt,
  cgMeta,
  monitorHealth,
  storageKind,
}: {
  generatedAt: string | null;
  cgMeta: SourceMeta | null;
  monitorHealth?: MonitorHealth | null;
  storageKind?: "redis" | "memory";
}) {
  // `Date.now()` é impuro — não pode ser chamado diretamente durante o render.
  // Calcula-se num efeito, após o mount, guardando apenas o resultado (uma string) em estado.
  const [monitorAgeLabel, setMonitorAgeLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!monitorHealth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deriva de Date.now(), que só pode ser lido após o mount
      setMonitorAgeLabel(null);
      return;
    }
    setMonitorAgeLabel(timeAgoShort(Date.now() - new Date(monitorHealth.lastRunAt).getTime()));
  }, [monitorHealth]);

  return (
    <header className="flex items-center justify-between px-4 sm:px-6 py-4">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[var(--accent-opportunity)] to-[var(--accent-risk)] flex items-center justify-center font-display font-bold text-[#0a0d13] text-sm">
          M
        </div>
        <div>
          <h1 className="font-display font-semibold text-base leading-none">MemeScope</h1>
          <p className="text-[10px] text-[var(--text-faint)] leading-none mt-0.5">
            Dashboard educativo de memecoins
          </p>
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-3">
        {monitorAgeLabel && (
          <span
            className="text-[10px] text-[var(--text-faint)]"
            title="Diagnóstico do job de monitorização (GET /api/health)"
          >
            Monitor: {monitorAgeLabel}
            {storageKind && ` · ${storageKind === "redis" ? "Redis" : "Memória (não persistente)"}`}
          </span>
        )}
        {cgMeta && <DataStatusBadge meta={cgMeta} />}
      </div>
      <span className="sr-only">{generatedAt}</span>
    </header>
  );
}
