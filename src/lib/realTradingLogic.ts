export type StopReason = "manual" | "max_entries" | "insufficient_balance" | "loss_streak" | "drawdown" | null;

export type SellPlan = {
  engine: "pumpportal" | "jupiter";
  slippagePct: number;
  pool?: "auto" | "pump" | "pump-amm" | "launchlab" | "bonk" | "raydium" | "raydium-cpmm";
};

export function classifyBuyError(message: string): "skip" | "fatal" {
  return /SKIP_TOKEN|PREBUY_SKIP|TooMuchSolRequired|TooLittleSolReceived|\b6002\b|\b6003\b|\b6005\b|\b6024\b|0x1772|0x1773|0x1775|0x1788|Overflow|BondingCurveComplete|slippage|blockhash|expired|simulation failed/i.test(message)
    ? "skip"
    : "fatal";
}

export function sellPlanForRetry(retry: number, baseSlippagePct: number, hasJupiter: boolean): SellPlan {
  const base = Math.max(5, Math.min(50, baseSlippagePct));
  const pumpPlans: SellPlan[] = [
    { engine: "pumpportal", pool: "auto", slippagePct: base },
    { engine: "pumpportal", pool: "auto", slippagePct: Math.max(base, 20) },
    { engine: "pumpportal", pool: "pump-amm", slippagePct: Math.max(base, 25) },
    { engine: "pumpportal", pool: "launchlab", slippagePct: Math.max(base, 25) },
    { engine: "pumpportal", pool: "bonk", slippagePct: Math.max(base, 30) },
    { engine: "pumpportal", pool: "raydium", slippagePct: Math.max(base, 30) },
    { engine: "pumpportal", pool: "raydium-cpmm", slippagePct: Math.max(base, 35) },
    { engine: "pumpportal", pool: "pump", slippagePct: Math.max(base, 40) },
  ];

  // After several PumpPortal attempts, Jupiter's meta-aggregator is a genuinely
  // different execution path. Keep alternating so one broken router cannot trap
  // the position forever.
  if (hasJupiter && retry >= 3 && retry % 3 === 0) {
    return { engine: "jupiter", slippagePct: Math.max(base, 20) };
  }
  return pumpPlans[Math.min(Math.max(0, retry), pumpPlans.length - 1)];
}

export function shouldQuarantineUnsellablePosition(args: {
  ageMs: number;
  retryCount: number;
  retrySinceMs?: number | null;
  nowMs?: number;
}): boolean {
  const now = args.nowMs ?? Date.now();
  const retryAge = args.retrySinceMs ? Math.max(0, now - args.retrySinceMs) : 0;

  // A position that has existed for many minutes and has already failed at least
  // one fresh exit attempt should not monopolize the only real-trading slot for
  // hours. Quarantine is explicit: the token is NOT claimed as sold and remains
  // blacklisted/audited, while its spent SOL is conservatively treated as lost.
  if (args.ageMs >= 15 * 60_000 && args.retryCount >= 1) return true;
  if (retryAge >= 3 * 60_000 && args.retryCount >= 4) return true;
  return args.retryCount >= 20;
}

// Kept for compatibility with older tests/imports. New code should use the
// quarantine name because the token may still exist on-chain.
export function shouldAbandonUnsellablePosition(ageMs: number, retryCount: number): boolean {
  return shouldQuarantineUnsellablePosition({ ageMs, retryCount });
}

export function marketCapSolFromFill(args: {
  inputSol: number;
  supplyRaw: string;
  acquiredRaw: string;
}): number | null {
  if (!(args.inputSol > 0)) return null;
  try {
    const supply = BigInt(args.supplyRaw);
    const acquired = BigInt(args.acquiredRaw);
    if (supply <= BigInt(0) || acquired <= BigInt(0)) return null;

    // Ratio with 1e9 fixed-point precision avoids converting very large raw token
    // supplies to Number before division.
    const scale = BigInt(1_000_000_000);
    const ratioScaled = (supply * scale) / acquired;
    const ratio = Number(ratioScaled) / Number(scale);
    const result = args.inputSol * ratio;
    return Number.isFinite(result) && result > 0 ? result : null;
  } catch {
    return null;
  }
}

export function circuitBreaker(args: {
  currentBalanceSol: number;
  peakBalanceSol: number;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  maxDrawdownPct: number;
}): StopReason {
  if (args.consecutiveLosses >= args.maxConsecutiveLosses) return "loss_streak";
  if (args.peakBalanceSol > 0) {
    const drawdownPct = ((args.peakBalanceSol - args.currentBalanceSol) / args.peakBalanceSol) * 100;
    if (drawdownPct >= args.maxDrawdownPct) return "drawdown";
  }
  return null;
}
