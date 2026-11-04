"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/primitives";
type View = { client: { name: string }; redirectHost: string; scopes: { id: string; label: string; checked: boolean }[]; workspace: { id: string; name: string }; user: { name: string; email: string } };
// 07C.3a: the OAuth consent screen of the MCP connector ("Permitir acesso"), for the workspace of the current session.
export function McpConsent({ requestId }: { requestId: string }) {
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(""), [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/mcp/oauth/consent?request=" + encodeURIComponent(requestId)).then(async r => {
      if (r.status === 401) { location.href = "/login?next=" + encodeURIComponent("/mcp/authorize?request=" + requestId); return; }
      const b = await r.json(); if (!r.ok) throw Error(b.error ?? "Não foi possível abrir o pedido."); setView(b); setPicked(b.scopes.filter((s: View["scopes"][number]) => s.checked).map((s: { id: string }) => s.id));
    }).catch(e => setError(e.message));
  }, [requestId]);
  async function decide(decision: "allow" | "deny") {
    if (!view) return; setBusy(true); setError("");
    try {
      const r = await fetch("/api/mcp/oauth/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, workspaceId: view.workspace.id, decision, scopes: picked }) });
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
        <p>Um aplicativo quer usar o Prometeus Cadence em seu nome. Depois de permitir, você volta para <strong>{view.redirectHost}</strong>.</p>
        <p className="muted">Nome informado pelo próprio aplicativo: <strong>{view.client.name}</strong>. Confira se o endereço de retorno é do aplicativo que você está conectando, como claude.ai ou chatgpt.com.</p>
        <dl className="mcp-consent-who"><dt>Conta</dt><dd>{view.user.name ? `${view.user.name} · ` : ""}{view.user.email}</dd><dt>Workspace</dt><dd>{view.workspace.name}</dd></dl>
        <fieldset className="mcp-consent-scopes"><legend>Esta conexão poderá:</legend>
          {view.scopes.map(s => {
            // Confirming only works together with preparing.
            const locked = s.id === "actions.confirm" && !picked.includes("actions.prepare");
            return <label key={s.id} className="checkbox-row"><input type="checkbox" checked={picked.includes(s.id) && !locked} disabled={busy || locked}
              onChange={e => setPicked(p => e.target.checked ? [...p, s.id] : p.filter(x => x !== s.id && !(s.id === "actions.prepare" && x === "actions.confirm")))} /><span>{s.label}</span></label>;
          })}
        </fieldset>
        {view.scopes.some(s => s.id === "actions.prepare") && <p className="muted">Preparar não muda nada: cada ação espera a sua confirmação aqui no Prometeus Cadence. Só marque “Confirmar” se quiser que o aplicativo confirme por você depois de mostrar o resumo.</p>}
        <p className="muted">Ela age com o seu papel neste workspace e não vê outros workspaces. Você pode revogar quando quiser em Configurações → MCP. Para usar outro workspace, troque o workspace ativo no aplicativo e conecte de novo.</p>
        <div className="form-actions"><Button disabled={busy} onClick={() => decide("deny")}>Recusar</Button><Button variant="primary" disabled={busy || !picked.length} onClick={() => decide("allow")}>{busy ? "Liberando…" : "Permitir acesso"}</Button></div>
      </>}
    </div>
  </main>;
}
