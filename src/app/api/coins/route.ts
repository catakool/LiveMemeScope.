import { NextResponse } from "next/server";
import { getDiscoveryFeed } from "@/lib/discovery";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { records, universeSize, meta } = await getDiscoveryFeed();
    return NextResponse.json({
      records,
      universeSize,
      generatedAt: new Date().toISOString(),
      meta,
    });
  } catch {
    return NextResponse.json(
      {
        records: [],
        universeSize: 0,
        generatedAt: new Date().toISOString(),
        meta: { coingecko: { status: "unavailable", lastUpdated: null, source: "coingecko" } },
        error: "Falha ao gerar a lista de descoberta.",
      },
      { status: 200 }
    );
  }
}
