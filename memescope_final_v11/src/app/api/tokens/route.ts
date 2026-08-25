import { NextResponse } from "next/server";
import { listWatchedTokens } from "@/lib/tokenRegistry";

export const dynamic = "force-dynamic";

export async function GET() {
  const tokens = await listWatchedTokens();
  return NextResponse.json({ tokens, count: tokens.length });
}
