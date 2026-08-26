export default function Disclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] rounded-lg ${
        compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"
      }`}
    >
      <span className="text-[var(--text)] font-medium">Aviso: </span>
      Esta aplicação apresenta dados e indicadores educativos. Não constitui aconselhamento
      financeiro. As memecoins são ativos altamente especulativos e podem perder todo o seu valor.
    </div>
  );
}
