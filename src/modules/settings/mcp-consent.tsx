"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/primitives";
type View = { client: { name: string }; redirectHost: string; scopes: { id: string; label: string }[]; workspace: { id: string; name: string }; user: { name: string; email: string } };
// 07C.3a: the OAuth consent screen of the MCP connector ("Permitir acesso"), for the workspace of the current session.
export function McpConsent({ requestId }: { requestId: string }) {
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState("");
  useEffect(() => {
    fetch("/api/mcp/oauth/consent?request=" + encodeURIComponent(requestId)).then(async r => {
      if (r.status === 401) { location.href = "/login?next=" + encodeURIComponent("/mcp/authorize?request=" + requestId); return; }
      const b = await r.json(); if (!r.ok) throw Error(b.error ?? "Não foi possível abrir o pedido."); setView(b);
    }).catch(e => setError(e.message));
  }, [requestId]);
  async function decide(decision: "allow" | "deny") {
    if (!view) return; setBusy(true); setError("");
    try {
      const r = await fetch("/api/mcp/oauth/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, workspaceId: view.workspace.id, decision }) });
      const b = await r.json(); if (!r.ok) throw Error(b.error ?? "Não foi possível concluir.");
      setDone(decision === "allow" ? "Acesso permitido. Voltando para o aplicativo…" : "Acesso recusado. Voltando para o aplicativo…"); location.href = b.redirectTo;
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <main className="auth-content entry-workspace mcp-consent" style={{ minHeight: "100svh" }}>
    <div className="auth-box">
      <span>◈ Prometeus Cadence</span>
      <h2>Permitir acesso ao seu workspace</h2>
      {error && <p role="alert" className="auth-error">{error}</p>}
      {done && <p role="status">{done}</p>}
      {!view && !error && <p role="status">Carregando o pedido de acesso…</p>}
      {view && !done && <>
        <p><strong>{view.client.name}</strong> quer usar o Prometeus Cadence em seu nome. Depois de permitir, você volta para <strong>{view.redirectHost}</strong>.</p>
        <dl className="mcp-consent-who"><dt>Conta</dt><dd>{view.user.name ? `${view.user.name} · ` : ""}{view.user.email}</dd><dt>Workspace</dt><dd>{view.workspace.name}</dd></dl>
        <p>Esta conexão poderá:</p>
        <ul className="mcp-consent-scopes">{view.scopes.map(s => <li key={s.id}>{s.label}</li>)}</ul>
        <p className="muted">Ela age com o seu papel neste workspace e não vê outros workspaces. Você pode revogar quando quiser em Configurações → MCP. Para usar outro workspace, troque o workspace ativo no aplicativo e conecte de novo.</p>
        <div className="form-actions"><Button disabled={busy} onClick={() => decide("deny")}>Recusar</Button><Button variant="primary" disabled={busy} onClick={() => decide("allow")}>{busy ? "Liberando…" : "Permitir acesso"}</Button></div>
      </>}
    </div>
  </main>;
}
