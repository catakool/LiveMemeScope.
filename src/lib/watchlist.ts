"use client";

import { Chain } from "./types";

const WATCHLIST_KEY = "memescope:watchlist:v1";
const CUSTOM_TOKENS_KEY = "memescope:custom-tokens:v1";

export interface CustomToken {
  coingeckoId: string | null; // pode ser null se só existir on-chain, sem listagem CoinGecko
  address: string;
  chain: Chain;
  symbolHint: string; // rótulo escolhido pelo utilizador, apenas para exibição
  addedAt: string;
  verifiedByUser: true;
}

export function getWatchlist(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WATCHLIST_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function toggleWatchlist(id: string): string[] {
  const current = getWatchlist();
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
  return next;
}

export function isInWatchlist(id: string): boolean {
  return getWatchlist().includes(id);
}

export function getCustomTokens(): CustomToken[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_TOKENS_KEY);
    return raw ? (JSON.parse(raw) as CustomToken[]) : [];
  } catch {
    return [];
  }
}

export function addCustomToken(token: CustomToken): CustomToken[] {
  const current = getCustomTokens();
  const next = [...current.filter((t) => t.address !== token.address), token];
  window.localStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(next));
  return next;
}

export function removeCustomToken(address: string): CustomToken[] {
  const next = getCustomTokens().filter((t) => t.address !== address);
  window.localStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(next));
  return next;
}
