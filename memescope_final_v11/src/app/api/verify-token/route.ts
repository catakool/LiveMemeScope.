import { NextRequest, NextResponse } from "next/server";
import { getDexDataByAddress } from "@/lib/dexscreener";

export const dynamic = "force-dynamic";

/**
 * Este endpoint NUNCA associa um token a partir do nome ou símbolo.
 * Recebe sempre um endereço de contrato explícito, fornecido pelo utilizador
 * a partir de uma fonte oficial (site do projeto, explorador de blockchain),
 * e devolve o que a DexScreener sabe sobre esse endereço para confirmação
 * visual antes de ser adicionado à watchlist.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const address = typeof body?.address === "string" ? body.address.trim() : "";

  if (!address || address.length < 20) {
    return NextResponse.json(
      { error: "Indique um endereço de contrato válido, copiado da fonte oficial do projeto." },
      { status: 400 }
    );
  }

  const { data, meta } = await getDexDataByAddress(address);

  if (!data) {
    return NextResponse.json({
      found: false,
      meta,
      warning:
        "Não foram encontrados pares para este endereço na DexScreener. Confirme se o contrato está correto e se já tem liquidez criada.",
    });
  }

  return NextResponse.json({
    found: true,
    address,
    dex: data,
    meta,
    warning:
      "Confirme sempre o endereço com a fonte oficial do projeto (site, X/Twitter verificado, documentação). " +
      "A existência de um par na DexScreener não garante que o contrato seja legítimo.",
  });
}
