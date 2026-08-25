"use client";

import { useState } from "react";
import { DexPairData } from "@/lib/types";
import { addCustomToken, getCustomTokens, removeCustomToken, CustomToken } from "@/lib/watchlist";
import { watchedTokenKey } from "@/lib/tokenKey";
import { formatUsd, formatDateTime } from "@/lib/format";

interface VerifyResponse {
  found: boolean;
  address?: string;
  dex?: DexPairData;
  warning: string;
}

export default function AddTokenPanel() {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [custom, setCustom] = useState<CustomToken[]>(
    typeof window !== "undefined" ? getCustomTokens() : []
  );
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const removeToken = async (t: CustomToken) => {
    const key = watchedTokenKey({ chain: t.chain, address: t.address });
    setRemovingKey(key);
    try {
      const res = await fetch("/api/tokens/register", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      // Idempotente: mesmo que o servidor diga "not_found", removemos da lista local na mesma.
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setRegisterError(json?.error ?? "Não foi possível remover o token no servidor. Tente novamente.");
        return;
      }
      setCustom(removeCustomToken(t.address));
    } catch {
      setRegisterError("Falha ao contactar o servidor ao remover o token. Tente novamente.");
    } finally {
      setRemovingKey(null);
    }
  };

  const verify = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/verify-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const json = (await res.json()) as VerifyResponse;
      setResult(json);
    } catch {
      setResult({ found: false, warning: "Falha ao contactar o serviço de verificação. Tente novamente." });
    } finally {
      setLoading(false);
    }
  };

  const confirmAdd = async () => {
    if (!result?.found || !result.dex) return;
    setRegistering(true);
    setRegisterError(null);
    try {
      const res = await fetch("/api/tokens/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          chain: result.dex.chain,
          symbol: label || "TOKEN",
          name: label || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRegisterError(json?.error ?? "Não foi possível registar o token no servidor.");
        return;
      }

      // localStorage continua a servir só como lista pessoal de conveniência —
      // a fonte de verdade dos dados é agora o registo no servidor (acima).
      const token: CustomToken = {
        coingeckoId: null,
        address,
        chain: result.dex.chain,
        symbolHint: label || "Token personalizado",
        addedAt: new Date().toISOString(),
        verifiedByUser: true,
      };
      setCustom(addCustomToken(token));
      setResult(null);
      setAddress("");
      setLabel("");
    } catch {
      setRegisterError("Falha ao contactar o servidor. Tente novamente.");
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
      <h3 className="font-display font-semibold text-sm">Adicionar token de risco extremo (ex.: CYBERLEEK)</h3>
      <p className="text-xs text-[var(--text-muted)]">
        Tokens de risco extremo só são adicionados depois de validar o endereço oficial do contrato.
        Nunca identifique um token apenas pelo nome ou símbolo — copie o endereço a partir da fonte oficial
        do projeto (site, redes sociais verificadas ou documentação) e cole-o aqui para confirmação.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Endereço do contrato (0x… ou endereço Solana)"
          className="flex-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm font-data placeholder:text-[var(--text-faint)] focus-ring outline-none"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Rótulo (ex.: CYBERLEEK)"
          className="sm:w-48 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm placeholder:text-[var(--text-faint)] focus-ring outline-none"
        />
        <button
          onClick={verify}
          disabled={loading || address.length < 20}
          className="px-4 py-1.5 rounded-lg bg-[var(--accent-info)] text-[#062431] text-sm font-medium disabled:opacity-40 focus-ring"
        >
          {loading ? "A verificar…" : "Verificar"}
        </button>
      </div>

      {result && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs space-y-2">
          <p className="text-[var(--accent-gold)]">{result.warning}</p>
          {result.found && result.dex && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[var(--text-muted)]">
                <div>Chain: <span className="font-data text-[var(--text)]">{result.dex.chain}</span></div>
                <div>Preço: <span className="font-data text-[var(--text)]">{formatUsd(result.dex.priceUsd)}</span></div>
                <div>Liquidez: <span className="font-data text-[var(--text)]">{formatUsd(result.dex.liquidityUsd, { compact: true })}</span></div>
                <div>Volume 24h: <span className="font-data text-[var(--text)]">{formatUsd(result.dex.volume24hUsd, { compact: true })}</span></div>
              </div>
              <button
                onClick={confirmAdd}
                disabled={registering}
                className="px-3 py-1.5 rounded-lg bg-[var(--accent-opportunity)] text-[#062421] font-medium disabled:opacity-50 focus-ring"
              >
                {registering ? "A registar…" : "Confirmo que verifiquei a origem — adicionar à watchlist"}
              </button>
              {registerError && <p className="text-[var(--accent-risk)]">{registerError}</p>}
              <p className="text-[10px] text-[var(--text-faint)]">
                O token fica registado no servidor e passa a acumular histórico (preço, volume, liquidez) a cada
                execução do job de monitorização, o que alimenta o Opportunity Engine e os alertas.
              </p>
            </>
          )}
        </div>
      )}

      {custom.length > 0 && (
        <div>
          <h4 className="text-xs text-[var(--text-faint)] uppercase tracking-wide mb-1.5">Tokens personalizados adicionados</h4>
          <ul className="space-y-1">
            {custom.map((t) => (
              <li key={t.address} className="flex items-center justify-between text-xs bg-[var(--surface-2)] rounded-lg px-2.5 py-1.5">
                <span>
                  <span className="font-data font-semibold">{t.symbolHint}</span>{" "}
                  <span className="text-[var(--text-faint)]">
                    {t.chain} · adicionado {formatDateTime(t.addedAt)}
                  </span>
                </span>
                <button
                  onClick={() => removeToken(t)}
                  disabled={removingKey === watchedTokenKey({ chain: t.chain, address: t.address })}
                  className="text-[var(--accent-risk)] hover:opacity-80 disabled:opacity-40 focus-ring"
                >
                  {removingKey === watchedTokenKey({ chain: t.chain, address: t.address }) ? "A remover…" : "Remover"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
