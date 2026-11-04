"use client";
import { useEffect, useState } from "react";
import type { AssistantProposal } from "@/domain/assistant-actions";
import { ProposalCard } from "@/components/shell/assistant-panel";
// 07C.3b: where the person reviews and confirms an action an MCP client prepared, with the assistant's own card.
export function McpReview({ id }: { id: string }) {
  const [view, setView] = useState<{ proposal: AssistantProposal; workspaceId: string } | null>(null), [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/assistant/" + encodeURIComponent(id) + "/view", { cache: "no-store" }).then(async r => {
      if (r.status === 401) { location.href = "/login?next=" + encodeURIComponent("/mcp/review/" + id); return; }
      const b = await r.json().catch(() => null);
      if (r.status === 404) throw Error("Não encontramos esta ação. Abra o link com a mesma conta e o mesmo workspace ativo que você conectou ao aplicativo.");
      if (!r.ok) throw Error(b?.message ?? "Não foi possível abrir a ação.");
      setView(b);
    }).catch(e => setError(e.message));
  }, [id]);
  return <main className="auth-content entry-workspace mcp-consent mcp-review" style={{ minHeight: "100svh" }}>
    <div className="auth-box">
      <span>◈ Prometeus Cadence</span>
      <h2>Revisar ação preparada pelo aplicativo</h2>
      {error && <p role="alert" className="auth-error">{error}</p>}
      {!view && !error && <p role="status">Carregando a ação…</p>}
      {view && <>
        <p className="muted">Um aplicativo conectado pelo MCP preparou esta ação. Nada muda até você revisar e confirmar. Se não reconhece o pedido, cancele.</p>
        <ProposalCard proposal={view.proposal} workspaceId={view.workspaceId} onClose={() => {}} />
      </>}
    </div>
  </main>;
}
