import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";
const MAX_ENTRIES = 20;
const STATE_KEY = "memescope:real-test:v22";
const DEFAULT_RESERVE_SOL = 0.003;
const DEFAULT_BUY_FRACTION = 0.25;
const DEFAULT_BUY_SLIPPAGE = 6;
const DEFAULT_SELL_SLIPPAGE = 12;
const DEFAULT_PRIORITY_FEE = 0.00005;
const DEFAULT_MAX_BUY_COST_PCT = 5;

type RealState = {
  entries:number;
  openMint:string|null;
  stopped:boolean;
  armed?:boolean;
  openEntryMarketCapSol?:number|null;
  openName?:string|null;
  openSymbol?:string|null;
  openOpenedAt?:number|null;
  openBalanceBeforeBuySol?:number|null;
  openBalanceAfterBuySol?:number|null;
  realizedPnlSol?:number;
  wins?:number; losses?:number;
  lastTradePnlSol?:number|null;
  lastTradeReturnPct?:number|null;
  lastPaperMirrorReturnPct?:number|null;
  lastExecutionGapPct?:number|null;
  skippedBuys?:number;
  lastSkipReason?:string|null;
  lastAction:string|null;
  lastSignature:string|null;
  lastError:string|null;
  startedAt:number|null;
};
const emptyState=():RealState=>({
  entries:0,openMint:null,stopped:false,armed:false,
  openEntryMarketCapSol:null,openName:null,openSymbol:null,openOpenedAt:null,
  openBalanceBeforeBuySol:null,openBalanceAfterBuySol:null,
  realizedPnlSol:0,wins:0,losses:0,lastTradePnlSol:null,lastTradeReturnPct:null,
  lastPaperMirrorReturnPct:null,lastExecutionGapPct:null,skippedBuys:0,lastSkipReason:null,
  lastAction:null,lastSignature:null,lastError:null,startedAt:null
});

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
async function getState(r:Redis){
  const raw=(await r.get<RealState>(STATE_KEY))??emptyState();
  return {
    ...emptyState(),
    ...raw,
    armed:Boolean(raw.armed),
    openEntryMarketCapSol:raw.openEntryMarketCapSol??null,
    openName:raw.openName??null,
    openSymbol:raw.openSymbol??null,
    openOpenedAt:raw.openOpenedAt??null,
    openBalanceBeforeBuySol:raw.openBalanceBeforeBuySol??null,
    openBalanceAfterBuySol:raw.openBalanceAfterBuySol??null,
    realizedPnlSol:Number(raw.realizedPnlSol)||0,wins:Number(raw.wins)||0,losses:Number(raw.losses)||0,
    lastTradePnlSol:raw.lastTradePnlSol??null,lastTradeReturnPct:raw.lastTradeReturnPct??null,
    lastPaperMirrorReturnPct:raw.lastPaperMirrorReturnPct??null,lastExecutionGapPct:raw.lastExecutionGapPct??null,
    skippedBuys:Number(raw.skippedBuys)||0,lastSkipReason:raw.lastSkipReason??null,
  };
}
async function saveState(r:Redis,s:RealState){ await r.set(STATE_KEY,s); }
async function walletSnapshot(c:Connection,k:Keypair){ const l=await c.getBalance(k.publicKey,"confirmed"); return {publicKey:k.publicKey.toBase58(),balanceSol:l/1e9}; }
async function portalTx(a:{publicKey:string;action:"buy"|"sell";mint:string;amount:number|string;denominatedInSol:"true"|"false"}){
  const slippage=a.action==="buy"
    ? Number(process.env.REAL_BUY_SLIPPAGE_PCT??process.env.REAL_SLIPPAGE_PCT??DEFAULT_BUY_SLIPPAGE)
    : Number(process.env.REAL_SELL_SLIPPAGE_PCT??process.env.REAL_SLIPPAGE_PCT??DEFAULT_SELL_SLIPPAGE);
  const response=await fetch("https://pumpportal.fun/api/trade-local",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    ...a,slippage,priorityFee:Number(process.env.REAL_PRIORITY_FEE_SOL??DEFAULT_PRIORITY_FEE),pool:"auto"
  })});
  if(!response.ok) throw new Error(`PumpPortal ${response.status}: ${(await response.text()).slice(0,180)}`);
  return new Uint8Array(await response.arrayBuffer());
}
async function signAndSend(c:Connection,k:Keypair,b:Uint8Array,opts?:{buyAmountSol?:number}){
  const tx=VersionedTransaction.deserialize(b);
  tx.sign([k]);

  // Economic preflight: simulate the exact signed transaction immediately before
  // sending it. A pump that already ran away is skipped rather than chased.
  const sim=await c.simulateTransaction(tx,{sigVerify:false,commitment:"processed"});
  if(sim.value.err){
    const logs=(sim.value.logs??[]).slice(-8).join(" | ");
    throw new Error(`PREBUY_SKIP simulation failed: ${JSON.stringify(sim.value.err)} ${logs}`.slice(0,900));
  }

  const feeInfo=await c.getFeeForMessage(tx.message,"confirmed");
  const baseFeeSol=(feeInfo.value??0)/1e9;
  const priorityFeeSol=Number(process.env.REAL_PRIORITY_FEE_SOL??DEFAULT_PRIORITY_FEE);
  const estimatedExecutionCostSol=baseFeeSol+priorityFeeSol;
  if(opts?.buyAmountSol && opts.buyAmountSol>0){
    const costPct=(estimatedExecutionCostSol/opts.buyAmountSol)*100;
    const maxCostPct=Number(process.env.REAL_MAX_BUY_COST_PCT??DEFAULT_MAX_BUY_COST_PCT);
    if(Number.isFinite(costPct)&&costPct>maxCostPct){
      throw new Error(`PREBUY_SKIP execution cost ${costPct.toFixed(2)}% > ${maxCostPct.toFixed(2)}% limit`);
    }
  }

  const sig=await c.sendTransaction(tx,{skipPreflight:false,maxRetries:3});
  await c.confirmTransaction(sig,"confirmed");
  return {sig,estimatedExecutionCostSol};
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
    if(action==="reset"){
      if(state.openMint) return NextResponse.json({ok:false,error:"No se puede resetear mientras exista una posición real abierta. Véndela primero."},{status:409});
      const s=emptyState(); await saveState(r,s); return NextResponse.json({ok:true,state:s});
    }
    if(action==="arm"){
      if(state.stopped) return NextResponse.json({ok:false,error:"REAL TEST detenido. Revisa el motivo antes de rearmar."},{status:409});
      const s={...state,armed:true,lastAction:"REAL TEST ARMED",lastError:null};
      await saveState(r,s); return NextResponse.json({ok:true,state:s});
    }
    if(action==="disarm"){
      const s={...state,armed:false,lastAction:"REAL TEST DISARMED"};
      await saveState(r,s); return NextResponse.json({ok:true,state:s});
    }
    if(action==="stop"){
      // Kill switch blocks NEW buys but intentionally keeps the current mint
      // so SELL remains possible. A kill switch must never trap an open token.
      const s={...state,stopped:true,armed:false,lastAction:"KILL SWITCH"};
      await saveState(r,s); return NextResponse.json({ok:true,state:s});
    }
    if(!mint||mint.length<30) return NextResponse.json({ok:false,error:"Mint inválido"},{status:400});
    const k=parseKeypair(), c=new Connection(rpcUrl(),"confirmed"), wallet=await walletSnapshot(c,k);

    if(action==="buy"){
      if(state.stopped||!state.armed) return NextResponse.json({ok:false,error:"REAL TEST no está armado para nuevas compras."},{status:409});
      if(state.entries>=MAX_ENTRIES){ const s={...state,stopped:true,lastAction:"MAX 20 ENTRIES"}; await saveState(r,s); return NextResponse.json({ok:false,error:"Máximo de 20 entradas alcanzado.",state:s},{status:409}); }
      if(state.openMint) return NextResponse.json({ok:false,error:"Ya existe una posición real abierta."},{status:409});
      const reserve=Number(process.env.REAL_RESERVE_SOL??DEFAULT_RESERVE_SOL);
      const fraction=Math.min(.5,Math.max(.05,Number(process.env.REAL_BUY_FRACTION??DEFAULT_BUY_FRACTION)));
      const amountSol=Math.min(Math.max(0,wallet.balanceSol-reserve),wallet.balanceSol*fraction);
      if(amountSol<=.0005){ const s={...state,stopped:true,lastAction:"INSUFFICIENT BALANCE",lastError:"Saldo insuficiente para otra entrada + fees."}; await saveState(r,s); return NextResponse.json({ok:false,error:s.lastError,state:s},{status:409}); }
      const balanceBeforeBuySol=wallet.balanceSol;
      let sent:{sig:string;estimatedExecutionCostSol:number};
      try{
        sent=await signAndSend(c,k,await portalTx({publicKey:wallet.publicKey,action:"buy",mint,amount:amountSol,denominatedInSol:"true"}),{buyAmountSol:amountSol});
      }catch(e){
        const message=e instanceof Error?e.message:"BUY preflight failed";
        if(/PREBUY_SKIP|TooMuchSolRequired|\b6002\b|0x1772|slippage.*too much sol|required to buy/i.test(message)){
          const skipped={...state,skippedBuys:(Number(state.skippedBuys)||0)+1,lastSkipReason:message.slice(0,240),lastAction:`SKIP ${mint.slice(0,6)}… · execution/preflight`,lastError:null};
          await saveState(r,skipped);
          return NextResponse.json({ok:false,skip:true,error:"SKIP_TOKEN",reason:message,state:skipped},{status:422});
        }
        throw e;
      }
      const sig=sent.sig;
      const walletAfterBuy=await walletSnapshot(c,k);
      const nextEntries=state.entries+1;
      const entryMc=Number(body?.entryMarketCapSol);
      const s:RealState={
        ...state,
        entries:nextEntries,
        openMint:mint,
        // At entry 20 we disarm NEW buys, but do not set stopped until the
        // open token is sold. This guarantees the final position can exit.
        armed:nextEntries<MAX_ENTRIES,
        stopped:false,
        openEntryMarketCapSol:Number.isFinite(entryMc)&&entryMc>0?entryMc:null,
        openName:typeof body?.name==="string"?body.name:null,
        openSymbol:typeof body?.symbol==="string"?body.symbol:null,
        openOpenedAt:Date.now(),
        openBalanceBeforeBuySol:balanceBeforeBuySol,openBalanceAfterBuySol:walletAfterBuy.balanceSol,
        lastAction:`BUY ${mint.slice(0,6)}… ${amountSol.toFixed(6)} SOL`,
        lastSignature:sig,lastError:null,startedAt:state.startedAt??Date.now()
      };
      await saveState(r,s); return NextResponse.json({ok:true,state:s,signature:sig,amountSol,wallet:await walletSnapshot(c,k)});
    }
    if(action==="sell"){
      if(state.openMint!==mint) return NextResponse.json({ok:false,error:"Ese mint no es la posición real abierta."},{status:409});
      const sold=await signAndSend(c,k,await portalTx({publicKey:wallet.publicKey,action:"sell",mint,amount:"100%",denominatedInSol:"false"}));
      const sig=sold.sig;
      const walletAfterSell=await walletSnapshot(c,k);
      const reachedMax=state.entries>=MAX_ENTRIES;
      const before=Number(state.openBalanceBeforeBuySol);
      const afterBuy=Number(state.openBalanceAfterBuySol);
      const pnl=Number.isFinite(before)?walletAfterSell.balanceSol-before:0;
      const spent=Number.isFinite(before)&&Number.isFinite(afterBuy)?Math.max(0,before-afterBuy):0;
      const tradeRet=spent>0?(pnl/spent)*100:null;
      const realized=(Number(state.realizedPnlSol)||0)+pnl;
      const wins=(Number(state.wins)||0)+(pnl>0?1:0), losses=(Number(state.losses)||0)+(pnl<0?1:0);
      const paperExitMc=Number(body?.paperExitMarketCapSol);
      const paperEntryMc=Number(state.openEntryMarketCapSol);
      const paperMirrorReturn=paperEntryMc>0&&paperExitMc>0?((paperExitMc/paperEntryMc)-1)*100:null;
      const executionGap=paperMirrorReturn!=null&&tradeRet!=null?tradeRet-paperMirrorReturn:null;
      const s:RealState={
        ...state,openMint:null,openEntryMarketCapSol:null,openName:null,openSymbol:null,openOpenedAt:null,
        openBalanceBeforeBuySol:null,openBalanceAfterBuySol:null,realizedPnlSol:realized,wins,losses,lastTradePnlSol:pnl,lastTradeReturnPct:tradeRet,
        lastPaperMirrorReturnPct:paperMirrorReturn,lastExecutionGapPct:executionGap,
        armed:reachedMax?false:Boolean(state.armed),stopped:reachedMax,
        lastAction:`SELL ${mint.slice(0,6)}… · REAL ${pnl>=0?"+":""}${pnl.toFixed(6)} SOL${reachedMax?` · MAX ${MAX_ENTRIES} COMPLETE`:""}`,
        lastSignature:sig,lastError:null
      };
      await saveState(r,s); return NextResponse.json({ok:true,state:s,signature:sig,wallet:walletAfterSell});
    }
    return NextResponse.json({ok:false,error:"Acción inválida"},{status:400});
  }catch(e){
    try{ const r=redisClient(),s=await getState(r); await saveState(r,{...s,lastError:e instanceof Error?e.message:"Error desconocido"}); }catch{}
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Error desconocido"},{status:500});
  }
}