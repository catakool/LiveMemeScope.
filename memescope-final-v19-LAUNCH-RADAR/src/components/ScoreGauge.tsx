"use client";

interface ScoreGaugeProps {
  opportunity: number | null;
  risk: number | null;
  opportunityConfidence: number;
  riskConfidence: number;
  size?: number;
}

function arc(radius: number, value: number | null, confidence: number) {
  const circumference = 2 * Math.PI * radius;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const dash = circumference * pct;
  // confiança baixa reduz a opacidade do traço, para não sugerir uma certeza que não existe
  const opacity = value === null ? 0.12 : 0.35 + confidence * 0.65;
  return { circumference, dash, opacity };
}

export default function ScoreGauge({
  opportunity,
  risk,
  opportunityConfidence,
  riskConfidence,
  size = 96,
}: ScoreGaugeProps) {
  const rOuter = 42;
  const rInner = 30;
  const outer = arc(rOuter, opportunity, opportunityConfidence);
  const inner = arc(rInner, risk, riskConfidence);
  const center = 50;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90">
        <circle cx={center} cy={center} r={rOuter} fill="none" stroke="var(--border)" strokeWidth={7} />
        <circle cx={center} cy={center} r={rInner} fill="none" stroke="var(--border)" strokeWidth={7} />
        <circle
          cx={center}
          cy={center}
          r={rOuter}
          fill="none"
          stroke="var(--accent-opportunity)"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${outer.dash} ${outer.circumference}`}
          style={{ opacity: outer.opacity, transition: "stroke-dasharray 0.6s ease" }}
        />
        <circle
          cx={center}
          cy={center}
          r={rInner}
          fill="none"
          stroke="var(--accent-risk)"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${inner.dash} ${inner.circumference}`}
          style={{ opacity: inner.opacity, transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center font-data leading-none">
        <span className="text-[var(--accent-opportunity)] font-semibold" style={{ fontSize: size * 0.16 }}>
          {opportunity ?? "–"}
        </span>
        <span className="text-[var(--text-faint)]" style={{ fontSize: size * 0.09 }}>
          /
        </span>
        <span className="text-[var(--accent-risk)] font-semibold" style={{ fontSize: size * 0.16 }}>
          {risk ?? "–"}
        </span>
      </div>
    </div>
  );
}
