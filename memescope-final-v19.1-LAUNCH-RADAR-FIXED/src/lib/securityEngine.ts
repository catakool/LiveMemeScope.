import { SecurityAssessment, SecurityProviderState } from "./storage";

const GOPLUS_URL = "https://api.gopluslabs.io/api/v1/solana/token_security";
const SOLSCAN_URL = "https://pro-api.solscan.io/v2.0";

function asObj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
function boolStatus(v: unknown): boolean | null {
  if (v === true || v === "1" || v === 1) return true;
  if (v === false || v === "0" || v === 0) return false;
  const o = asObj(v);
  return o ? boolStatus(o.status) : null;
}
function pct(v: unknown): number | null {
  const n = num(v); if (n === null) return null;
  return Math.round((n <= 1 ? n * 100 : n) * 100) / 100;
}
function timeout(ms: number) {
  const ctrl = new AbortController(); const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

interface GoPlusSummary {
  provider: SecurityProviderState;
  holderCount: number | null;
  top1: number | null;
  top10: number | null;
  creatorPercent: number | null;
  lpLockedPercent: number | null;
  mintable: boolean | null;
  freezable: boolean | null;
  closable: boolean | null;
  balanceMutable: boolean | null;
  metadataMutable: boolean | null;
  maliciousAuthority: boolean;
  defaultFrozen: boolean;
}

function emptyGoPlus(detail: string): GoPlusSummary {
  return { provider: { status: "unavailable", detail }, holderCount: null, top1: null, top10: null, creatorPercent: null, lpLockedPercent: null, mintable: null, freezable: null, closable: null, balanceMutable: null, metadataMutable: null, maliciousAuthority: false, defaultFrozen: false };
}

async function fetchGoPlus(address: string): Promise<GoPlusSummary> {
  const u = new URL(GOPLUS_URL); u.searchParams.set("contract_addresses", address);
  const headers: Record<string,string> = { accept: "application/json" };
  if (process.env.GOPLUS_ACCESS_TOKEN) headers.authorization = `Bearer ${process.env.GOPLUS_ACCESS_TOKEN}`;
  const t = timeout(6500);
  try {
    const res = await fetch(u, { headers, signal: t.signal, cache: "no-store" });
    if (!res.ok) return emptyGoPlus(`HTTP ${res.status}`);
    const body = asObj(await res.json());
    const result = asObj(body?.result);
    if (!result) return emptyGoPlus("Resposta sem result");
    const data = asObj(result[address]) ?? asObj(result[address.toLowerCase()]) ?? (Object.values(result).map(asObj).find(Boolean) ?? null);
    if (!data) return emptyGoPlus("Token sem dados GoPlus");

    const holders = Array.isArray(data.holders) ? data.holders.map(asObj).filter(Boolean) as Record<string,unknown>[] : [];
    const holderPcts = holders.map(h => pct(h.percent)).filter((x): x is number => x !== null);
    const unlockedNonBurn = holders.filter(h => {
      const tag=(str(h.tag)??"").toLowerCase();
      return !tag.includes("burn") && !tag.includes("dead") && !boolStatus(h.is_locked);
    });
    const unlockedPcts = unlockedNonBurn.map(h => pct(h.percent)).filter((x): x is number => x !== null);
    const lp = Array.isArray(data.lp_holders) ? data.lp_holders.map(asObj).filter(Boolean) as Record<string,unknown>[] : [];
    const lockedLp = lp.filter(h => boolStatus(h.is_locked)).map(h => pct(h.percent)).filter((x): x is number => x !== null);

    const authorityObjects = [data.mintable, data.freezable, data.closable, data.balance_mutable_authority, data.metadata_mutable].map(asObj).filter(Boolean) as Record<string,unknown>[];
    const maliciousAuthority = authorityObjects.some(o => {
      const a = asObj(o.authority) ?? asObj(o.metadata_upgrade_authority);
      return boolStatus(a?.malicious_address) === true;
    });

    return {
      provider: { status: "live", detail: null },
      holderCount: num(data.holder_count),
      top1: unlockedPcts.length ? Math.max(...unlockedPcts) : (holderPcts.length ? Math.max(...holderPcts) : null),
      top10: unlockedPcts.length ? Math.round(unlockedPcts.reduce((a,b)=>a+b,0)*100)/100 : (holderPcts.length ? Math.round(holderPcts.reduce((a,b)=>a+b,0)*100)/100 : null),
      creatorPercent: pct(data.creator_percent),
      lpLockedPercent: lockedLp.length ? Math.min(100, Math.round(lockedLp.reduce((a,b)=>a+b,0)*100)/100) : null,
      mintable: boolStatus(data.mintable),
      freezable: boolStatus(data.freezable),
      closable: boolStatus(data.closable),
      balanceMutable: boolStatus(data.balance_mutable_authority),
      metadataMutable: boolStatus(data.metadata_mutable),
      maliciousAuthority,
      defaultFrozen: String(data.default_account_state ?? "") === "2",
    };
  } catch (e) { return emptyGoPlus(e instanceof Error ? e.message : "GoPlus indisponível"); }
  finally { t.clear(); }
}

interface SolscanSummary {
  provider: SecurityProviderState;
  holderCount: number | null;
  top1: number | null;
  top10: number | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}
function emptySolscan(status: SecurityProviderState["status"], detail: string): SolscanSummary {
  return { provider: { status, detail }, holderCount: null, top1: null, top10: null, mintAuthority: null, freezeAuthority: null };
}
async function solscanGet(path: string, params: Record<string,string>): Promise<Record<string,unknown> | null> {
  const key=process.env.SOLSCAN_API_KEY; if (!key) return null;
  const u=new URL(`${SOLSCAN_URL}${path}`); Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  const t=timeout(6500);
  try {
    const res=await fetch(u,{headers:{accept:"application/json",token:key},signal:t.signal,cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return asObj(await res.json());
  } finally { t.clear(); }
}
async function fetchSolscan(address: string): Promise<SolscanSummary> {
  if (!process.env.SOLSCAN_API_KEY) return emptySolscan("not_configured", "SOLSCAN_API_KEY não configurada");
  try {
    const [meta, holders] = await Promise.all([
      solscanGet("/token/meta", { address }),
      solscanGet("/token/holders", { address, page:"1", page_size:"10" }),
    ]);
    const md=asObj(meta?.data); const hd=asObj(holders?.data);
    const items=Array.isArray(hd?.items) ? hd.items.map(asObj).filter(Boolean) as Record<string,unknown>[] : [];
    const raw=items.map(i=>num(i.percentage)).filter((x):x is number=>x!==null);
    // Solscan versions have returned either fractions or percentage points; infer from aggregate.
    const scale = raw.length && raw.reduce((a,b)=>a+b,0) <= 1.05 ? 100 : 1;
    const ps=raw.map(v=>v*scale);
    return {
      provider:{status:"live",detail:null},
      holderCount:num(hd?.total),
      top1:ps.length?Math.round(Math.max(...ps)*100)/100:null,
      top10:ps.length?Math.round(ps.reduce((a,b)=>a+b,0)*100)/100:null,
      mintAuthority:str(md?.mint_authority),
      freezeAuthority:str(md?.freeze_authority),
    };
  } catch(e) { return emptySolscan("unavailable", e instanceof Error ? e.message : "Solscan indisponível"); }
}

function uniq(xs: string[]) { return [...new Set(xs)]; }
export async function assessSolanaTokenSecurity(address: string): Promise<SecurityAssessment> {
  const [g,s]=await Promise.all([fetchGoPlus(address),fetchSolscan(address)]);
  const blockers:string[]=[]; const warnings:string[]=[]; const positives:string[]=[];
  let score=100;
  const mintable=g.mintable ?? (s.mintAuthority ? true : s.provider.status==="live" ? false : null);
  const freezable=g.freezable ?? (s.freezeAuthority ? true : s.provider.status==="live" ? false : null);
  const top1=g.top1 ?? s.top1; const top10=g.top10 ?? s.top10; const holderCount=g.holderCount ?? s.holderCount;

  if (g.defaultFrozen) { blockers.push("Novas contas do token podem nascer congeladas"); score-=70; }
  if (g.closable===true) { blockers.push("Programa/token pode ser fechado pela autoridade"); score-=65; }
  if (g.balanceMutable===true) { blockers.push("Autoridade pode alterar saldos de holders"); score-=65; }
  if (g.maliciousAuthority) { blockers.push("GoPlus assinala uma autoridade relacionada como maliciosa"); score-=70; }
  if (freezable===true) { blockers.push("Freeze authority ativa / token pode congelar contas"); score-=45; }
  if (mintable===true) { warnings.push("Mint authority ativa: supply pode ser aumentado"); score-=20; } else if (mintable===false) positives.push("Mint authority desativada/não detetada");
  if (g.metadataMutable===true) { warnings.push("Metadata do token pode ser alterada"); score-=8; }
  if (g.creatorPercent!==null && g.creatorPercent>15) { warnings.push(`Creator concentra ${g.creatorPercent.toFixed(1)}% do supply`); score-=20; }
  if (top1!==null && top1>25) { blockers.push(`Maior holder não bloqueado concentra ~${top1.toFixed(1)}%`); score-=40; }
  else if (top1!==null && top1>12) { warnings.push(`Maior holder concentra ~${top1.toFixed(1)}%`); score-=15; }
  if (top10!==null && top10>70) { warnings.push(`Top holders concentram ~${top10.toFixed(1)}%`); score-=25; }
  else if (top10!==null && top10>45) { warnings.push(`Top holders concentram ~${top10.toFixed(1)}%`); score-=12; }
  if (holderCount!==null && holderCount>=500) positives.push(`${Math.round(holderCount).toLocaleString("en-US")} holders detetados`);
  if (g.lpLockedPercent!==null && g.lpLockedPercent>=50) positives.push(`GoPlus deteta ~${g.lpLockedPercent.toFixed(0)}% de LP bloqueada`);
  else if (g.lpLockedPercent!==null && g.lpLockedPercent<20) warnings.push("Pouca LP identificada como bloqueada pela GoPlus");

  score=Math.max(0,Math.min(100,Math.round(score)));
  const liveProviders=[g.provider,s.provider].filter(p=>p.status==="live").length;
  const completeness=Math.round((liveProviders/2)*100);
  const critical=blockers.length>0 && (score<=40 || g.defaultFrozen || g.closable===true || g.balanceMutable===true || g.maliciousAuthority || freezable===true);
  const risk = liveProviders===0 ? "unknown" : critical ? "critical" : score<55 ? "high" : score<75 ? "medium" : "low";
  return {
    checkedAt:new Date().toISOString(), score:liveProviders?score:null, risk, critical, completeness,
    blockers:uniq(blockers), warnings:uniq(warnings), positives:uniq(positives),
    providers:{goplus:g.provider,solscan:s.provider}, holderCount,
    top1HolderPercent:top1, top10HolderPercent:top10, creatorPercent:g.creatorPercent,
    lpLockedPercent:g.lpLockedPercent, mintAuthority:s.mintAuthority, freezeAuthority:s.freezeAuthority,
    mintable, freezable, closable:g.closable, balanceMutable:g.balanceMutable, metadataMutable:g.metadataMutable,
  };
}
