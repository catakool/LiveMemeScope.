import { SourceMeta } from "@/lib/types";
import { timeAgo } from "@/lib/format";

const CONFIG = {
  live: { label: "Dados atualizados", dot: "bg-[var(--accent-opportunity)]" },
  stale: { label: "Dados atrasados", dot: "bg-[var(--accent-gold)]" },
  unavailable: { label: "API indisponível", dot: "bg-[var(--accent-risk)]" },
} as const;

export default function DataStatusBadge({
  meta,
  label,
}: {
  meta: SourceMeta;
  label?: string;
}) {
  const cfg = CONFIG[meta.status];
  return (
    <div className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]" title={meta.lastUpdated ?? undefined}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      <span>{label ?? cfg.label}</span>
      {meta.lastUpdated && <span className="font-data text-[var(--text-faint)]">· {timeAgo(meta.lastUpdated)}</span>}
    </div>
  );
}
