import { describe, expect, it } from "vitest";
import {
  circuitBreaker,
  classifyBuyError,
  marketCapSolFromFill,
  sellPlanForRetry,
  shouldQuarantineUnsellablePosition,
} from "../realTradingLogic";

describe("realTradingLogic", () => {
  it("treats pump overflow/slippage as a skipped token, not a fatal bot error", () => {
    expect(classifyBuyError("custom program error: 0x1788 Overflow 6024")).toBe("skip");
    expect(classifyBuyError("TooMuchSolRequired 6002")).toBe("skip");
    expect(classifyBuyError("REAL_WALLET_PRIVATE_KEY missing")).toBe("fatal");
  });

  it("escalates sell routes and alternates through Jupiter when configured", () => {
    expect(sellPlanForRetry(0, 12, false)).toMatchObject({ engine: "pumpportal", pool: "auto", slippagePct: 12 });
    expect(sellPlanForRetry(2, 12, false)).toMatchObject({ engine: "pumpportal", pool: "pump-amm" });
    expect(sellPlanForRetry(3, 12, true).engine).toBe("jupiter");
    expect(sellPlanForRetry(4, 12, true)).toMatchObject({ engine: "pumpportal", pool: "bonk" });
  });

  it("quarantines a hours-old unsellable token after a fresh failed exit", () => {
    expect(shouldQuarantineUnsellablePosition({ ageMs: 60 * 60_000, retryCount: 0 })).toBe(false);
    expect(shouldQuarantineUnsellablePosition({ ageMs: 60 * 60_000, retryCount: 1 })).toBe(true);
    expect(shouldQuarantineUnsellablePosition({ ageMs: 30_000, retryCount: 19 })).toBe(false);
    expect(shouldQuarantineUnsellablePosition({ ageMs: 30_000, retryCount: 20 })).toBe(true);
  });

  it("derives an effective fill market cap from actual SOL in and tokens received", () => {
    // 1B-token supply (6 decimals), 10M tokens received for 0.02 SOL => 2 SOL MC.
    expect(marketCapSolFromFill({
      inputSol: 0.02,
      supplyRaw: "1000000000000000",
      acquiredRaw: "10000000000000",
    })).toBeCloseTo(2, 8);
    expect(marketCapSolFromFill({ inputSol: 0.02, supplyRaw: "0", acquiredRaw: "10" })).toBeNull();
  });

  it("stops on configured loss streak/drawdown", () => {
    expect(circuitBreaker({ currentBalanceSol: .08, peakBalanceSol: .12, consecutiveLosses: 1, maxConsecutiveLosses: 4, maxDrawdownPct: 30 })).toBe("drawdown");
    expect(circuitBreaker({ currentBalanceSol: .11, peakBalanceSol: .12, consecutiveLosses: 4, maxConsecutiveLosses: 4, maxDrawdownPct: 30 })).toBe("loss_streak");
  });
});
