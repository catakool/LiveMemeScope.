import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";
const MAX_ENTRIES = 20;
const STATE_KEY = "memescope:real-test:v22";
const DEFAULT_RESERVE_SOL = 0.003;
const DEFAULT_BUY_FRACTION = 0.25;
const DEFAULT_SLIPPAGE = 10;
const DEFAULT_PRIORITY_FEE = 0.00005;

type RealState = { entries:number; openMint:string|null; stopped:boolean; lastAction:string|null; lastSignature:string|null; lastError:string|null; startedAt:number|null };
const emptyState=():RealState=>({entries:0,openMint:null,stopped:false,lastAction:null,lastSignature:null,lastError:null,startedAt:null});

function redisClient(){
  const url=process.env.KV_REST_API_URL??process.env.UPSTASH_REDIS_REST_URL;
  const token=process.env.KV_REST_API_TOKEN??process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token) throw new Error("REAL TEST requiere Upstash Redis para aplicar el límite de 20 entradas.");
  return new Redis({url,token});
}
function parseKeypair(){
  const raw=process.env.REAL_WALLET_PRIVATE_KEY?.trim();
  if(!raw) throw new Error("REAL_WALLET_PRIVATE_KEY no configurada.");
  if(raw.startsWith("[")){ const a=JSON.parse(raw); return Keypair.fromSecretKey(Uint8Array.from(a)); }
  return Keypair.fromSecretKey(bs58.decode(raw));
}
function rpcUrl(){ return process.env.SOLANA_RPC_URL?.trim()||"https://api.mainnet-beta.solana.com"; }
function authorized(req:NextRequest){ const x=process.env.REAL_CONTROL_TOKEN?.trim(); return Boolean(x&&req.headers.get("x-real-control-token")===x); }
async function getState(r:Redis){ return (await r.get<RealState>(STATE_KEY))??emptyState(); }
async function saveState(r:Redis,s:RealState){ await r.set(STATE_KEY,s); }
async function walletSnapshot(c:Connection,k:Keypair){ const l=await c.getBalance(k.publicKey,"confirmed"); return {publicKey:k.publicKey.toBase58(),balanceSol:l/1e9}; }
async function portalTx(a:{publicKey:string;action:"buy"|"sell";mint:string;amount:number|string;denominatedInSol:"true"|"false"}){
  const response=await fetch("https://pumpportal.fun/api/trade-local",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    ...a,slippage:Number(process.env.REAL_SLIPPAGE_PCT??DEFAULT_SLIPPAGE),priorityFee:Number(process.env.REAL_PRIORITY_FEE_SOL??DEFAULT_PRIORITY_FEE),pool:"auto"
  })});
  if(!response.ok) throw new Error(`PumpPortal ${response.status}: ${(await response.text()).slice(0,180)}`);
  return new Uint8Array(await response.arrayBuffer());
}
async function signAndSend(c:Connection,k:Keypair,b:Uint8Array){
  const tx=VersionedTransaction.deserialize(b); tx.sign([k]);
  const sig=await c.sendTransaction(tx,{skipPreflight:false,maxRetries:3});
  await c.confirmTransaction(sig,"confirmed"); return sig;
}

export async function GET(req:NextRequest){
  if(!authorized(req)) return NextResponse.json({ok:false,error:"No autorizado"},{status:401});
  try{
    const r=redisClient(), k=parseKeypair(), c=new Connection(rpcUrl(),"confirmed");
    return NextResponse.json({ok:true,state:await getState(r),wallet:await walletSnapshot(c,k),maxEntries:MAX_ENTRIES,buyFraction:Number(process.env.REAL_BUY_FRACTION??DEFAULT_BUY_FRACTION),reserveSol:Number(process.env.REAL_RESERVE_SOL??DEFAULT_RESERVE_SOL)});
  }catch(e){ return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Error"},{status:500}); }
}
export async function POST(req:NextRequest){
  if(!authorized(req)) return NextResponse.json({ok:false,error:"No autorizado"},{status:401});
  try{
    const body=await req.json(), action=String(body?.action??""), mint=String(body?.mint??"");
    const r=redisClient(), state=await getState(r);
    if(action==="reset"){ const s=emptyState(); await saveState(r,s); return NextResponse.json({ok:true,state:s}); }
    if(action==="stop"){ const s={...state,stopped:true,lastAction:"KILL SWITCH"}; await saveState(r,s); return NextResponse.json({ok:true,state:s}); }
    if(!mint||mint.length<30) return NextResponse.json({ok:false,error:"Mint inválido"},{status:400});
    if(state.stopped) return NextResponse.json({ok:false,error:"REAL TEST detenido."},{status:409});
    const k=parseKeypair(), c=new Connection(rpcUrl(),"confirmed"), wallet=await walletSnapshot(c,k);

    if(action==="buy"){
      if(state.entries>=MAX_ENTRIES){ const s={...state,stopped:true,lastAction:"MAX 20 ENTRIES"}; await saveState(r,s); return NextResponse.json({ok:false,error:"Máximo de 20 entradas alcanzado.",state:s},{status:409}); }
      if(state.openMint) return NextResponse.json({ok:false,error:"Ya existe una posición real abierta."},{status:409});
      const reserve=Number(process.env.REAL_RESERVE_SOL??DEFAULT_RESERVE_SOL);
      const fraction=Math.min(.5,Math.max(.05,Number(process.env.REAL_BUY_FRACTION??DEFAULT_BUY_FRACTION)));
      const amountSol=Math.min(Math.max(0,wallet.balanceSol-reserve),wallet.balanceSol*fraction);
      if(amountSol<=.0005){ const s={...state,stopped:true,lastAction:"INSUFFICIENT BALANCE",lastError:"Saldo insuficiente para otra entrada + fees."}; await saveState(r,s); return NextResponse.json({ok:false,error:s.lastError,state:s},{status:409}); }
      const sig=await signAndSend(c,k,await portalTx({publicKey:wallet.publicKey,action:"buy",mint,amount:amountSol,denominatedInSol:"true"}));
      const s:RealState={...state,entries:state.entries+1,openMint:mint,stopped:state.entries+1>=MAX_ENTRIES,lastAction:`BUY ${mint.slice(0,6)}… ${amountSol.toFixed(6)} SOL`,lastSignature:sig,lastError:null,startedAt:state.startedAt??Date.now()};
      await saveState(r,s); return NextResponse.json({ok:true,state:s,signature:sig,amountSol,wallet:await walletSnapshot(c,k)});
    }
    if(action==="sell"){
      if(state.openMint!==mint) return NextResponse.json({ok:false,error:"Ese mint no es la posición real abierta."},{status:409});
      const sig=await signAndSend(c,k,await portalTx({publicKey:wallet.publicKey,action:"sell",mint,amount:"100%",denominatedInSol:"false"}));
      const s:RealState={...state,openMint:null,lastAction:`SELL ${mint.slice(0,6)}…`,lastSignature:sig,lastError:null};
      await saveState(r,s); return NextResponse.json({ok:true,state:s,signature:sig,wallet:await walletSnapshot(c,k)});
    }
    return NextResponse.json({ok:false,error:"Acción inválida"},{status:400});
  }catch(e){
    try{ const r=redisClient(),s=await getState(r); await saveState(r,{...s,lastError:e instanceof Error?e.message:"Error desconocido"}); }catch{}
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Error desconocido"},{status:500});
  }
}