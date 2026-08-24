import { OpportunityClassification, CLASSIFICATION_LABEL } from "@/lib/opportunity";

const TIER_STYLE: Record<OpportunityClassification, { color: string; bg: string }> = {
  very_strong_opportunity: { color: "#062421", bg: "var(--accent-opportunity)" },
  strong_opportunity: { color: "#0a0d13", bg: "var(--accent-gold)" },
  high_momentum_watch: { color: "#062431", bg: "var(--accent-info)" },
  watch: { color: "var(--text)", bg: "var(--surface-2)" },
  no_signal: { color: "var(--text-faint)", bg: "var(--surface-2)" },
};

export default function OpportunityBadge({
  classification,
  size = "sm",
}: {
  classification: OpportunityClassification;
  size?: "sm" | "md";
}) {
  const style = TIER_STYLE[classification];
  const padding = size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold whitespace-nowrap ${padding}`}
      style={{ color: style.color, background: style.bg }}
    >
      {CLASSIFICATION_LABEL[classification]}
    </span>
  );
}
