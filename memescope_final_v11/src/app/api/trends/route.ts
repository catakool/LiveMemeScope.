import { NextResponse } from "next/server";
import { getTrendsFeed } from "@/lib/trends";

export const dynamic = "force-dynamic";

export async function GET() {
  const feed = await getTrendsFeed();
  return NextResponse.json(feed, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
