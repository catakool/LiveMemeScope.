import { NextRequest, NextResponse } from "next/server";
import { runMonitorCycle } from "@/lib/monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos — ajuste conforme o plano Vercel (Hobby costuma limitar a 60s)

/**
 * Endpoint chamado pelo Vercel Cron Job (ver vercel.json) a cada poucos minutos.
 *
 * Segurança: se a variável de ambiente CRON_SECRET estiver definida, este
 * endpoint exige o cabeçalho `Authorization: Bearer <CRON_SECRET>`, que a
 * própria Vercel envia automaticamente nas chamadas de cron quando essa
 * variável está configurada no projeto. Sem CRON_SECRET definido, o endpoint
 * fica acessível (útil em desenvolvimento local) — defina-a em produção.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }
  }

  const summary = await runMonitorCycle();
  return NextResponse.json(summary);
}
