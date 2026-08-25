// ---------------------------------------------------------------------------
// Interface preparada para catalisadores externos (Fase 12 do pedido).
// ---------------------------------------------------------------------------
// NENHUMA fonte está implementada nesta versão (sem X/Twitter, Reddit,
// notícias, etc.) — nada de scraping frágil, nada de dados inventados.
// Isto existe apenas para que uma fonte fiável possa ser plugada no futuro
// sem alterar o Opportunity Engine.
// ---------------------------------------------------------------------------

export interface CatalystSignal {
  label: string;
  weight: number; // 0-100, força do catalisador
  source: string;
  url?: string;
}

export interface CatalystProvider {
  name: string;
  /** Devolve catalisadores conhecidos para um token, ou [] se não houver/fonte indisponível. */
  getCatalysts(params: { coingeckoId: string | null; chain: string; address: string | null }): Promise<CatalystSignal[]>;
}

/** Implementação nula: usada enquanto nenhuma fonte de catalisadores está integrada. */
export const NULL_CATALYST_PROVIDER: CatalystProvider = {
  name: "none",
  async getCatalysts() {
    return [];
  },
};
