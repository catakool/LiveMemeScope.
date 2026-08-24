export function formatUsd(v: number | null | undefined, opts?: { compact?: boolean }): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "N/D";
  if (opts?.compact) {
    return new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(v);
  }
  const digits = Math.abs(v) < 1 ? 6 : 2;
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

export function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "N/D";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

export function formatCompactNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "N/D";
  return new Intl.NumberFormat("pt-PT", { notation: "compact", maximumFractionDigits: 2 }).format(v);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "N/D";
  try {
    return new Intl.DateTimeFormat("pt-PT", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(iso));
  } catch {
    return "N/D";
  }
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "N/D";
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 5) return "agora mesmo";
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  return `há ${h}h`;
}
