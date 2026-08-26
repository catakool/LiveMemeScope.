import { NextRequest, NextResponse } from "next/server";
import { closeManualPosition, getTradingLabSummary, openManualPosition } from "@/lib/tradingLab";
import type { RadarCandidate } from "@/lib/newTokenRadar";
export const dynamic = "force-dynamic";
export async function GET(){return NextResponse.json(await getTradingLabSummary());}
export async function POST(req:NextRequest){try{const body=await req.json();if(body?.action==="open_manual"){const candidate=body?.candidate as RadarCandidate|undefined;if(!candidate?.tokenKey||!candidate?.price)return NextResponse.json({error:"Candidate inválido."},{status:400});return NextResponse.json({position:await openManualPosition(candidate,Number(body?.notionalUsd)||10)});}if(body?.action==="close_manual"){const id=typeof body?.id==="string"?body.id:"";return NextResponse.json({position:await closeManualPosition(id)});}return NextResponse.json({error:"Ação inválida."},{status:400});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Falha no Trading Lab."},{status:500});}}
