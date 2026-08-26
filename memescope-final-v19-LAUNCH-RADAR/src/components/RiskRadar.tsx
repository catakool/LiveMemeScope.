"use client";

import { ScoreResult } from "@/lib/types";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";

export default function RiskRadar({ risk }: { risk: ScoreResult }) {
  const available = risk.components.filter((c) => c.available && c.value !== null);

  if (available.length < 3) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-muted)]">
        Dados insuficientes para desenhar o radar de risco desta moeda (menos de 3 métricas disponíveis).
      </div>
    );
  }

  const data = available.map((c) => ({ label: c.label, value: c.value }));

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="font-display font-semibold text-sm mb-1">Radar de risco</h3>
      <p className="text-xs text-[var(--text-faint)] mb-2">
        Mostra apenas as {available.length} métrica(s) com dados reais disponíveis, de {risk.components.length} no total.
      </p>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis dataKey="label" stroke="var(--text-faint)" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar dataKey="value" stroke="var(--accent-risk)" fill="var(--accent-risk)" fillOpacity={0.35} />
            <Tooltip
              contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
