import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { OPPORTUNITY_CONFIG } from "@/lib/opportunityConfig";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico público (sem segredos) do job de monitorização, para a UI
 * poder mostrar discretamente "Monitor: Live/Stale", "Storage: Redis/Memory"
 * e "Last update: X min ago" (Fase 17 do hardening).
 */
export async function GET() {
  const storage = getStorage();
  const health = await storage.getMonitorHealth();

  if (!health) {
    return NextResponse.json({
      status: "never_run",
      storageKind: storage.kind,
      health: null,
    });
  }

  const ageMs = Date.now() - new Date(health.lastRunAt).getTime();
  const isLive = ageMs <= OPPORTUNITY_CONFIG.freshness.maxLiveSnapshotAgeMs * 2; // tolerância um pouco maior que o gate de "live opportunity"

  return NextResponse.json({
    status: isLive ? "live" : "stale",
    ageMs,
    storageKind: storage.kind,
    health,
  });
}
