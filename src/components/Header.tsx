"use client";

import { SourceMeta } from "@/lib/types";
import DataStatusBadge from "./DataStatusBadge";

export default function Header({ generatedAt, cgMeta }: { generatedAt: string | null; cgMeta: SourceMeta | null }) {
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
      {cgMeta && (
        <div className="hidden sm:block">
          <DataStatusBadge meta={cgMeta} />
        </div>
      )}
      <span className="sr-only">{generatedAt}</span>
    </header>
  );
}
