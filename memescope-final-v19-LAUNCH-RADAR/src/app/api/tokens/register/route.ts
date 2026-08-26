import { NextRequest, NextResponse } from "next/server";
import { getDexDataByAddress } from "@/lib/dexscreener";
import { registerManualToken, removeManualToken } from "@/lib/tokenRegistry";
import { Chain } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_CHAINS: Chain[] = ["ethereum", "solana", "base", "bsc", "unknown"];

/**
 * Regista, no servidor, um token verificado manualmente (AddTokenPanel).
 * A identidade é sempre chain + endereço de contrato — nunca o símbolo.
 * Isto corrige o problema em que tokens adicionados manualmente ficavam
 * presos em localStorage e nunca entravam no pipeline de dados.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const symbol = typeof body?.symbol === "string" && body.symbol.trim() ? body.symbol.trim() : "TOKEN";
  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const coingeckoId = typeof body?.coingeckoId === "string" ? body.coingeckoId : null;
  const chainInput = typeof body?.chain === "string" ? body.chain : null;

  if (!address || address.length < 20) {
    return NextResponse.json(
      { error: "Indique um endereço de contrato válido." },
      { status: 400 }
    );
  }

  // Reconfirma sempre no servidor (nunca confia apenas no que o cliente diz ter verificado antes).
  const chainHint = chainInput && VALID_CHAINS.includes(chainInput as Chain) ? (chainInput as Chain) : undefined;
  const { data: dex } = await getDexDataByAddress(address, chainHint);

  if (!dex) {
    return NextResponse.json(
      { error: "Não foi possível confirmar este contrato na DexScreener. Verifique o endereço antes de tentar novamente." },
      { status: 404 }
    );
  }

  const token = await registerManualToken({
    chain: dex.chain,
    address,
    coingeckoId,
    symbol,
    name,
  });

  return NextResponse.json({
    registered: true,
    token,
    note:
      "O token foi registado no servidor e vai começar a acumular histórico de preço/volume/liquidez a partir da próxima execução do job de monitorização (aproximadamente a cada 1-2 minutos). O Opportunity Score só fica disponível depois de existir histórico suficiente.",
  });
}

/**
 * Remove um token adicionado manualmente (Fase 2 do hardening).
 * Idempotente: repetir a chamada para um token já removido devolve sucesso
 * (removed: false, reason: "not_found"), nunca um erro.
 */
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key : "";

  if (!key) {
    return NextResponse.json({ error: "Indique a tokenKey do token a remover." }, { status: 400 });
  }

  const result = await removeManualToken(key);

  return NextResponse.json({
    ...result,
    note: result.removed
      ? "O token deixou de ser monitorizado. O registo de vigilância e o estado atual foram apagados; " +
        "os sinais históricos já gerados por este token foram conservados para auditoria/backtesting."
      : undefined,
  });
}
