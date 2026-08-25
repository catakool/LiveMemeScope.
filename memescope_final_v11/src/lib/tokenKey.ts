import { Chain } from "./types";

// ---------------------------------------------------------------------------
// Identidade única de um token: chain + endereço de contrato quando existe,
// ou `cg:<coingeckoId>` para moedas nativas sem contrato (ex.: DOGE).
// NUNCA o símbolo sozinho, e NUNCA usar esta chave como se fosse um
// coingeckoId — são conceitos distintos (ver TokenDefinition.tokenKey vs
// TokenDefinition.coingeckoId em lib/types.ts).
//
// Este ficheiro não importa nada do Redis/Upstash de propósito: é seguro
// importar a partir de componentes "use client" (ex.: para calcular a mesma
// chave ao apagar um token adicionado manualmente).
// ---------------------------------------------------------------------------

export function watchedTokenKey(params: { coingeckoId?: string | null; chain: Chain; address?: string | null }): string {
  if (params.address) return `${params.chain}:${params.address.toLowerCase()}`;
  if (params.coingeckoId) return `cg:${params.coingeckoId}`;
  throw new Error("watchedTokenKey requer address+chain ou coingeckoId");
}

/** Decompõe uma tokenKey de volta nas suas partes, para os casos em que só temos a string. */
export function parseTokenKey(key: string): { chain: Chain | null; address: string | null; coingeckoId: string | null } {
  if (key.startsWith("cg:")) {
    return { chain: null, address: null, coingeckoId: key.slice(3) };
  }
  const idx = key.indexOf(":");
  if (idx > 0) {
    const chain = key.slice(0, idx) as Chain;
    const address = key.slice(idx + 1);
    return { chain, address, coingeckoId: null };
  }
  // Nem "cg:" nem "chain:address" — assume-se o próprio valor como coingeckoId
  // (compatibilidade com chamadas antigas que ainda passem um id "nu").
  return { chain: null, address: null, coingeckoId: key };
}
