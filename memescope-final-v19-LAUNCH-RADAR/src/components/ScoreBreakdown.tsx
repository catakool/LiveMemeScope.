"use client";

import { ScoreResult } from "@/lib/types";

export default function ScoreBreakdown({
  title,
  result,
  accent,
}: {
  title: string;
  result: ScoreResult;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-display font-semibold text-sm">{title}</h3>
        <span className="font-data text-lg font-semibold" style={{ color: accent }}>
          {result.score ?? "N/D"}
        </span>
      </div>
      <p className="text-xs text-[var(--text-faint)] mb-3">
        Confiança: {(result.confidence * 100).toFixed(0)}% do peso da fórmula tem dados reais disponíveis.
        {result.score === null && " Pontuação não calculada por falta de dados suficientes."}
      </p>
      <ul className="space-y-2">
        {result.components.map((c) => (
          <li key={c.key}>
            <div className="flex items-center justify-between text-xs mb-0.5">
              <span className="text-[var(--text-muted)]">
                {c.label} <span className="text-[var(--text-faint)]">· peso {(c.weight * 100).toFixed(0)}%</span>
              </span>
              <span className="font-data">
                {c.available && c.value !== null ? c.value.toFixed(0) : "não disponível"}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
              {c.available && c.value !== null ? (
                <div
                  className="h-full rounded-full"
                  style={{ width: `${c.value}%`, background: accent }}
                />
              ) : (
                <div
                  className="h-full w-full rounded-full"
                  style={{
                    background:
                      "repeating-linear-gradient(45deg, var(--border), var(--border) 4px, transparent 4px, transparent 8px)",
                  }}
                />
              )}
            </div>
            {c.detail && <p className="text-[10px] text-[var(--text-faint)] mt-0.5">{c.detail}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
