"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIdentity } from "@/client/workspace-provider";
import { Icon } from "@/components/ui/icon";
import { Badge, Button, Modal, Notice } from "@/components/ui/primitives";
import { useConnectorApi } from "./apollo-connection";
// Settings → Base de conhecimento da empresa: documents belong to the company; each agent picks the ones it reads (SDR first).
type Doc = { id: string; revision: number; title: string; mime: string; bytes: number; state: "uploaded" | "processing" | "ready" | "approved" | "failed" | "archived"; error: string | null; pages: number | null; chunks: number | null; approvedAt: string | null; createdAt: string; sourceUrl: string | null };
type View = { canManage: boolean; documents: Doc[] };
const states: Record<Doc["state"], [string, "neutral" | "green" | "orange" | "red"]> = { uploaded: ["Na fila", "neutral"], processing: ["Processando", "neutral"], ready: ["Pronto para revisar", "orange"], approved: ["Aprovado", "green"], failed: ["Falhou", "red"], archived: ["Arquivado", "neutral"] };
const failures: Record<string, string> = {
  KNOWLEDGE_UNREADABLE: "Não conseguimos ler o arquivo. Confira se ele abre normalmente e envie de novo.",
  KNOWLEDGE_TOO_MANY_PAGES: "O PDF passa de 300 páginas. Divida em partes menores.",
  KNOWLEDGE_EMPTY: "O arquivo não tem texto para a busca.",
  KNOWLEDGE_EMBED_FAILED: "Não foi possível preparar a busca agora. Exclua e envie de novo.",
  KNOWLEDGE_CHUNK_LIMIT: "A base da empresa chegou ao limite de 20.000 trechos.",
  KNOWLEDGE_ATTEMPTS: "O processamento falhou 3 vezes. Exclua e envie de novo.",
  KNOWLEDGE_TOO_LARGE: "O arquivo tem conteúdo demais para a base (mais de 1.000 trechos ou 100 MB descompactado). Divida em partes menores.",
  KNOWLEDGE_SCAN_TOO_LONG: "O PDF escaneado é longo demais para ler de uma vez. Divida em partes menores.",
};
const size = (b: number) => b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + " KB" : (b / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
export function CompanyKnowledge() {
  const api = useConnectorApi(), ws = useIdentity()?.activeWorkspaceId, input = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ doc: Doc; chunks: { ordinal: number; label: string; text: string }[] } | null>(null), [remove, setRemove] = useState<Doc | null>(null);
  const load = useCallback(() => api<View>("/api/knowledge/documents").then(setView).catch(e => setError(e.message)), [api]);
  useEffect(() => { void load(); }, [load]);
  const working = view?.documents.some(d => d.state === "uploaded" || d.state === "processing");
  useEffect(() => { if (!working) return; const t = setInterval(() => void load(), 4000); return () => clearInterval(t); }, [working, load]);
  async function act(fn: () => Promise<unknown>) { setBusy(true); setError(""); try { await fn(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function upload(file: File) {
    if (!ws) return;
    await act(async () => {
      const body = new FormData(); body.append("file", file);
      let r: Response; try { r = await fetch("/api/knowledge/documents", { method: "POST", cache: "no-store", headers: { "x-cadence-workspace": ws }, body }); } catch { throw Error("Sem conexão com o servidor. Tente de novo."); }
      const data = await r.json().catch(() => null); if (!r.ok) throw Error(data?.message ?? "Não foi possível enviar o arquivo.");
    });
    if (input.current) input.current.value = "";
  }
  return <>
    <h1>Base de conhecimento da empresa</h1>
    <p className="subtitle">Documentos da sua empresa que os agentes de IA podem consultar: tabela de preços, script comercial, apresentação, regras de negócio. Cada agente escolhe quais documentos usa; por enquanto, só o Agente SDR consulta esta base. As páginas do site lidas em Configurações → Contexto de IA entram aqui sozinhas, já aprovadas, e são substituídas a cada nova leitura; o agente que consulta a base também consulta todas elas.</p>
    <section className="reference-panel"><header><Icon name="BookOpen" /><div><h2>Documentos</h2><p>PDF, Word, Excel, CSV, TXT ou Markdown, até 10 MB e 50 documentos. Antes de aprovar, confira a prévia do texto lido. Um documento só é usado depois de aprovado, e o conteúdo dele é informação, nunca ordem para o agente.</p></div></header><div className="reference-panel-body">
      {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
      {view?.canManage && <div className="row wrap"><input ref={input} type="file" hidden accept=".pdf,.docx,.xlsx,.csv,.txt,.md" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} /><Button variant="primary" disabled={busy} onClick={() => input.current?.click()}><Icon name="Upload" size={14} />{busy ? "Enviando…" : "Enviar documento"}</Button><small className="muted">Para trocar um documento, envie a nova versão, aprove e depois arquive a antiga.</small></div>}
      {!view && !error && <p className="muted" role="status">Carregando documentos…</p>}
      {view && !view.documents.length && <p className="muted">Nenhum documento ainda.{view.canManage ? " Envie o primeiro acima." : " Peça a um administrador para enviar."}</p>}
      {!!view?.documents.length && <ul className="sdr-agent-list">{view.documents.map(d => <li key={d.id}><div><strong>{d.title}</strong>
        {d.sourceUrl && <small className="muted">Página do site · <a href={d.sourceUrl} target="_blank" rel="noreferrer">{d.sourceUrl}</a></small>}
        <small className="muted">{size(d.bytes)}{d.pages ? ` · ${d.pages} ${d.pages === 1 ? "página" : "páginas"}` : ""}{d.chunks ? ` · ${d.chunks} trechos` : ""}</small>
        {d.state === "failed" && <small role="alert" className="error-text">{failures[d.error ?? ""] ?? "Não foi possível processar este arquivo."}</small>}</div>
        <div className="row wrap">{d.sourceUrl && <Badge tone="neutral">Site</Badge>}<Badge tone={states[d.state][1]}>{states[d.state][0]}</Badge>
          {(d.state === "ready" || d.state === "approved") && <Button variant="ghost" disabled={busy} onClick={() => act(async () => setPreview({ doc: d, ...(await api<{ chunks: { ordinal: number; label: string; text: string }[] }>(`/api/knowledge/documents/${d.id}/preview`)) }))}>Ver prévia</Button>}
          {view.canManage && d.state === "ready" && <Button disabled={busy} onClick={() => act(() => api(`/api/knowledge/documents/${d.id}/approve`, { expectedRevision: d.revision }))}>Aprovar</Button>}
          {view.canManage && d.state === "approved" && <Button variant="ghost" disabled={busy} onClick={() => act(() => api(`/api/knowledge/documents/${d.id}/archive`, { expectedRevision: d.revision }))}>Arquivar</Button>}
          {view.canManage && <Button variant="ghost" disabled={busy} onClick={() => setRemove(d)}>Excluir</Button>}</div></li>)}</ul>}
    </div></section>
    {preview && <Modal title={"Prévia · " + preview.doc.title} onClose={() => setPreview(null)}><div className="stack">
      <p className="muted">Os primeiros trechos que o agente vai poder consultar. Se uma tabela ou um texto saiu errado, exclua e envie o arquivo em outro formato.</p>
      {preview.chunks.map(c => <div key={c.ordinal} className="panel panel-pad"><strong>{c.label}</strong><pre className="knowledge-preview">{c.text}</pre></div>)}
      <div className="row wrap">{view?.canManage && preview.doc.state === "ready" && <Button variant="primary" disabled={busy} onClick={() => act(async () => { await api(`/api/knowledge/documents/${preview.doc.id}/approve`, { expectedRevision: preview.doc.revision }); setPreview(null); })}>Aprovar documento</Button>}<Button onClick={() => setPreview(null)}>Fechar</Button></div>
    </div></Modal>}
    {remove && <Modal title={"Excluir " + remove.title + "?"} onClose={() => !busy && setRemove(null)}><div className="stack"><p>O arquivo e os trechos dele saem da base. Os agentes que usavam este documento deixam de consultá-lo. Não dá para desfazer.{remove.sourceUrl ? " A página volta na próxima leitura do site em Contexto de IA." : ""}</p>
      <div className="row wrap"><Button disabled={busy} onClick={() => setRemove(null)}>Voltar</Button><Button variant="primary" disabled={busy} onClick={() => act(async () => { await api(`/api/knowledge/documents/${remove.id}/delete`, {}); setRemove(null); })}>Excluir documento</Button></div></div></Modal>}
  </>;
}
