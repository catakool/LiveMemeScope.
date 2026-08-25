"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { PricePoint } from "@/lib/coingecko";

export default function PriceChart({ prices }: { prices: PricePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8891a4",
        fontFamily: "var(--font-data)",
      },
      grid: {
        vertLines: { color: "#232a3a" },
        horzLines: { color: "#232a3a" },
      },
      rightPriceScale: { borderColor: "#232a3a" },
      timeScale: { borderColor: "#232a3a", timeVisible: true },
      height: 280,
      autoSize: true,
    });

    const series = chart.addAreaSeries({
      lineColor: "#5eead4",
      topColor: "rgba(94, 234, 212, 0.35)",
      bottomColor: "rgba(94, 234, 212, 0.02)",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 6, minMove: 0.000001 },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    const data = prices
      .map((p) => ({ time: Math.floor(p.t / 1000) as UTCTimestamp, value: p.price }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    // remove duplicados de timestamp (a lib exige ordem estritamente crescente)
    const deduped = data.filter((d, i) => i === 0 || d.time !== data[i - 1].time);
    seriesRef.current.setData(deduped);
    chartRef.current?.timeScale().fitContent();
  }, [prices]);

  if (prices.length === 0) {
    return (
      <div className="h-[280px] flex items-center justify-center text-sm text-[var(--text-muted)]">
        Sem histórico de preço disponível.
      </div>
    );
  }

  return <div ref={containerRef} className="w-full" />;
}
