import { NextResponse } from "next/server";
import { getNewTokenRadarFeed } from "@/lib/newTokenRadar";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET() { return NextResponse.json(await getNewTokenRadarFeed()); }
