import type { RadarCandidate } from "./newTokenRadar";

export type CatalystStrength = "none" | "low" | "medium" | "high" | "extreme";
export type CatalystKind = "official_social" | "website" | "dex_boost" | "community_takeover" | "news" | "reddit" | "unknown";

export interface CatalystEvidence {
  kind: CatalystKind;
  label: string;
  url: string | null;
  observedAt: string;
  weight: number;
}

export interface CatalystAssessment {
  score: number;
  strength: CatalystStrength;
  confidence: "low" | "medium" | "high";
  narrative: string;
  reasons: string[];
  evidence: CatalystEvidence[];
  sourceStatus: {
    dexscreener: "live" | "unavailable";
    news: "live" | "disabled" | "unavailable";
    reddit: "disabled" | "not_configured";
  };
  checkedAt: string;
}

interface PairInfo {
  description?: string | null;
  websites?: Array<{ url?: string }> | null;
  socials?: Array<{ platform?: string; handle?: string }> | null;
  boosts?: { active?: number } | null;
}

const CACHE = new Map<string, { at: number; value: CatalystAssessment }>();
const TTL = 10 * 60_000;

function clamp(v:number){return Math.max(0,Math.min(100,v));}
function strength(score:number): CatalystStrength { return score>=85?"extreme":score>=70?"high":score>=50?"medium":score>=25?"low":"none"; }
function safeUrl(v: unknown): string | null { return typeof v === "string" && /^https?:\/\//i.test(v) ? v : null; }

async function getDexInfo(c: RadarCandidate): Promise<{ info: PairInfo | null; takeover: boolean }> {
  try {
    const [pairsRes, takeoverRes] = await Promise.all([
      fetch(`https://api.dexscreener.com/token-pairs/v1/${c.chain}/${c.address}`),
      fetch("https://api.dexscreener.com/community-takeovers/latest/v1"),
    ]);
    const pairs = pairsRes.ok ? await pairsRes.json() as Array<PairInfo & { liquidity?: { usd?: number }, pairAddress?: string }> : [];
    const best = [...pairs].sort((a,b)=>(b.liquidity?.usd??0)-(a.liquidity?.usd??0))[0] ?? null;
    const takeovers = takeoverRes.ok ? await takeoverRes.json() as Array<{chainId?:string;tokenAddress?:string}> : [];
    const takeover = takeovers.some(x => x.chainId === c.chain && x.tokenAddress?.toLowerCase() === c.address.toLowerCase());
    return { info: best, takeover };
  } catch { return { info: null, takeover: false }; }
}

// Optional server-side news enrichment. No key = no cost and no failure.
// NEWS_API_KEY is deliberately optional; the engine still produces a transparent
// catalyst score from token-owned links / DexScreener metadata.
async function getNewsEvidence(c: RadarCandidate): Promise<CatalystEvidence[]> {
  const key = process.env.NEWS_API_KEY;
  if (!key) return [];
  try {
    const q = encodeURIComponent(`\"${c.name}\" OR \"${c.symbol}\" crypto`);
    const res = await fetch(`https://newsapi.org/v2/everything?q=${q}&sortBy=publishedAt&pageSize=5&language=en`, { headers: { "X-Api-Key": key }, cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json() as { articles?: Array<{title?:string;url?:string;publishedAt?:string}> };
    const cutoff = Date.now() - 48*60*60_000;
    return (data.articles ?? []).filter(a => a.publishedAt && new Date(a.publishedAt).getTime() >= cutoff).slice(0,3).map(a => ({
      kind:"news" as const, label:a.title ?? "Recent news mention", url:safeUrl(a.url), observedAt:a.publishedAt!, weight:18,
    }));
  } catch { return []; }
}

export async function assessCatalyst(c: RadarCandidate): Promise<CatalystAssessment> {
  const cached=CACHE.get(c.tokenKey); if(cached && Date.now()-cached.at<TTL) return cached.value;
  const checkedAt=new Date().toISOString();
  const {info,takeover}=await getDexInfo(c);
  const evidence:CatalystEvidence[]=[];
  let score=0;
  const reasons:string[]=[];
  const socials=info?.socials ?? [];
  const websites=info?.websites ?? [];
  if(socials.length){ score+=18; reasons.push(`${socials.length} canal(is) social(is) oficial(is) ligado(s) ao token`); socials.slice(0,2).forEach(s=>evidence.push({kind:"official_social",label:`${s.platform ?? "social"}: ${s.handle ?? c.symbol}`,url:null,observedAt:checkedAt,weight:9})); }
  if(websites.length){ score+=8; reasons.push("Website/projeto ligado ao perfil DEX"); websites.slice(0,1).forEach(w=>evidence.push({kind:"website",label:"Website do projeto",url:safeUrl(w.url),observedAt:checkedAt,weight:8})); }
  if((info?.boosts?.active ?? 0)>0){ score+=6; reasons.push("Boost ativo na DexScreener (promoção paga; evidência fraca)"); evidence.push({kind:"dex_boost",label:"DexScreener boost ativo",url:null,observedAt:checkedAt,weight:6}); }
  if(takeover){ score+=12; reasons.push("Community takeover recente na DexScreener"); evidence.push({kind:"community_takeover",label:"Community takeover",url:null,observedAt:checkedAt,weight:12}); }
  const news=await getNewsEvidence(c); if(news.length){ score+=Math.min(45, news.length*18); reasons.push(`${news.length} menção(ões) noticiosa(s) recente(s)`); evidence.push(...news); }
  // Market reaction is supporting evidence, not the catalyst itself.
  if((c.volumeM5??0)>0 && (c.liquidityUsd??0)>0 && (c.volumeM5! / c.liquidityUsd!)>=0.25){score+=8;reasons.push("Mercado está a reagir com turnover 5m elevado");}
  if((c.priceChangeM5??0)>=8){score+=5;reasons.push("Preço reage rapidamente em 5m");}
  score=clamp(score);
  const narrative = news[0]?.label ?? (info?.description?.slice(0,140) || (socials.length ? "Narrativa ligada aos canais oficiais do token" : "Sem catalisador externo confirmado"));
  const value:CatalystAssessment={score,strength:strength(score),confidence:news.length>=2?"high":evidence.length>=2?"medium":"low",narrative,reasons,evidence,sourceStatus:{dexscreener:info?"live":"unavailable",news:process.env.NEWS_API_KEY?(news.length?"live":"unavailable"):"disabled",reddit:"disabled"},checkedAt};
  CACHE.set(c.tokenKey,{at:Date.now(),value}); return value;
}
