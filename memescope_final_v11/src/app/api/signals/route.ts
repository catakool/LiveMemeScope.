import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tokenKey = searchParams.get("tokenKey");
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500);

  const storage = getStorage();
  const signals = await storage.getRecentSignals(tokenKey, limit);
  return NextResponse.json({ signals, storage: storage.kind });
}
