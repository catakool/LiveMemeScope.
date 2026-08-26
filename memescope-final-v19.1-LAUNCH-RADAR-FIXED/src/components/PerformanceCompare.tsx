"use client";

import { CoinRecord, CoinScores } from "@/lib/types";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";

export default function PerformanceCompare({ records }: { records: (CoinRecord & { scores: CoinScores })[] }) {
  const data = records.map((r) => ({
    symbol: r.def.symbol,
    "24h": r.market?.change24h ?? null,
    "7d": r.market?.change7d ?? null,
    "30d": r.market?.change30d ?? null,
  }));

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="font-display font-semibold text-sm mb-3">Comparação de desempenho</h3>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="symbol" stroke="var(--text-faint)" fontSize={11} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
            <YAxis stroke="var(--text-faint)" fontSize={11} tickLine={false} axisLine={{ stroke: "var(--border)" }} unit="%" />
            <Tooltip
              contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "var(--text)" }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
            <Bar dataKey="24h" fill="var(--accent-info)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="7d" fill="var(--accent-opportunity)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="30d" fill="var(--accent-gold)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
