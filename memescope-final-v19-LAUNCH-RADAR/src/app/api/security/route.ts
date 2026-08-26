import { NextRequest, NextResponse } from "next/server";
import { assessSolanaTokenSecurity } from "@/lib/securityEngine";
export const dynamic="force-dynamic";
export const maxDuration=15;
export async function GET(req:NextRequest){
  const address=new URL(req.url).searchParams.get("address")?.trim() ?? "";
  if(address.length<32 || address.length>50) return NextResponse.json({error:"Mint Solana inválido."},{status:400});
  return NextResponse.json(await assessSolanaTokenSecurity(address));
}
