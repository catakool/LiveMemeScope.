"use client";

import { useState } from "react";
import Header from "@/components/Header";
import NewTokenRadar from "@/components/NewTokenRadar";
import LaunchRadar from "@/components/LaunchRadar";
import TradingLab from "@/components/TradingLab";

type MainTab = "launch" | "trading" | "advanced";

export default function Home() {
  const [mainTab, setMainTab] = useState<MainTab>("launch");

  return (
    <div className="flex-1 flex flex-col">
      <Header generatedAt={null} cgMeta={null} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 w-fit">
          <button onClick={() => setMainTab("launch")} className={`rounded-lg px-4 py-2 text-sm font-medium ${mainTab === "launch" ? "bg-[var(--surface-2)] text-[var(--accent-gold)]" : "text-[var(--text-muted)]"}`}>⚡ Launch Radar</button>
          <button onClick={() => setMainTab("trading")} className={`rounded-lg px-4 py-2 text-sm font-medium ${mainTab === "trading" ? "bg-[var(--surface-2)] text-[var(--accent-opportunity)]" : "text-[var(--text-muted)]"}`}>📈 Trading Lab</button>
          <button onClick={() => setMainTab("advanced")} className={`rounded-lg px-4 py-2 text-sm font-medium ${mainTab === "advanced" ? "bg-[var(--surface-2)] text-[var(--accent-info)]" : "text-[var(--text-muted)]"}`}>Advanced</button>
        </div>

        {mainTab === "launch" ? <LaunchRadar /> : mainTab === "trading" ? <TradingLab /> : <NewTokenRadar />}
      </main>

      <footer className="px-4 sm:px-6 py-6 text-center text-xs text-[var(--text-faint)]">
        MemeScope — dados via CoinGecko e DexScreener. Não é aconselhamento financeiro.
      </footer>

    </div>
  );
}