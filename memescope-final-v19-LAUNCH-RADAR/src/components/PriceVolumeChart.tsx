"use client";

import { MarketChart } from "@/lib/coingecko";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatCompactNumber, formatUsd } from "@/lib/format";

export default function PriceVolumeChart({ chart }: { chart: MarketChart | null }) {
  if (!chart || chart.prices.length === 0) {
    return (
      <div className="h-[280px] flex items-center justify-center text-sm text-[var(--text-muted)]">
        Sem dados de preço/volume disponíveis.
      </div>
    );
  }

  const volumeByTime = new Map(chart.volumes.map((v) => [v.t, v.volume]));
  const data = chart.prices.map((p) => ({
    t: p.t,
    price: p.price,
    volume: volumeByTime.get(p.t) ?? null,
  }));

  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={(t) => new Date(t).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" })}
            stroke="var(--text-faint)"
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            yAxisId="volume"
            orientation="right"
            stroke="var(--text-faint)"
            fontSize={10}
            tickFormatter={(v) => formatCompactNumber(v)}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="price"
            stroke="var(--text-faint)"
            fontSize={10}
            tickFormatter={(v) => formatCompactNumber(v)}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(t) => new Date(Number(t)).toLocaleString("pt-PT")}
            formatter={(value, name) =>
              name === "volume"
                ? [formatUsd(Number(value), { compact: true }), "Volume"]
                : [formatUsd(Number(value)), "Preço"]
            }
          />
          <Bar yAxisId="volume" dataKey="volume" fill="var(--accent-info)" opacity={0.35} radius={[2, 2, 0, 0]} />
          <Line yAxisId="price" type="monotone" dataKey="price" stroke="var(--accent-opportunity)" dot={false} strokeWidth={2} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
