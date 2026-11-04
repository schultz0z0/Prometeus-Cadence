"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Button, Field, Modal, Notice } from "@/components/ui/primitives";
import { useConnectorApi } from "./apollo-connection";
type Connection = { id: string; clientName: string; userName: string | null; mine: boolean; scopes: { id: string; label: string }[]; createdAt: string; lastUsedAt: string | null };
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
// Ready prompts the tools can serve; actions are prepared for review and wait for confirmation.
const ready = [
  { title: "Resumo da semana", text: "Como foi a minha prospecção nos últimos 7 dias no Prometeus Cadence? Mostra enviados, respostas, falhas e descadastros por canal e me diz o que chama atenção." },
  { title: "Encontrar leads", text: "Procura nos meus contatos do Prometeus Cadence os leads de [segmento ou cidade] que ainda não responderam e lista nome, empresa e cidade." },
  { title: "Andamento das execuções", text: "Quais execuções do Prometeus Cadence rodaram recentemente? Diz quais terminaram, quais estão rodando e se alguma falhou." },
  { title: "Leads novos toda semana, sozinho", text: "Prepara no Prometeus Cadence um público de [segmento] em [cidade ou estado] com automações pausadas por [e-mail ou WhatsApp]. Me mostra o resumo antes de confirmar." },
  { title: "O que responder pra quem respondeu", text: "Olha as conversas recentes no Prometeus Cadence e prepara um rascunho de resposta para quem precisa de retorno. Não envie nada: só quero revisar os rascunhos." },
  { title: "Cadência para uma lista", text: "Prepara no Prometeus Cadence opções de cadência para a lista [nome da lista], com o objetivo de [agendar uma conversa], por [e-mail], em tom [consultivo e direto]. Me mostra o resumo antes de confirmar." },
];
const later = ["Configurar a conta do zero", "Reescrever uma cadência com tom humano"];
function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <Button icon={done ? "Check" : "Copy"} onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }); }}>{done ? "Copiado" : label}</Button>;
}
export function McpSettings() {
  const api = useConnectorApi(), [data, setData] = useState<{ connections: Connection[]; url: string } | null>(null), [error, setError] = useState(""), [revoke, setRevoke] = useState<Connection | null>(null), [busy, setBusy] = useState(false);
  const load = () => { setError(""); api<{ connections: Connection[]; url: string }>("/api/mcp/connections").then(setData).catch(e => setError(e.message)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [api]);
  async function doRevoke() { if (!revoke) return; setBusy(true); try { await api(`/api/mcp/connections/${revoke.id}/revoke`, {}); setRevoke(null); load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <div className="reference-settings mcp-reference"><h1>MCP</h1><p className="subtitle">Opere o Prometeus Cadence de dentro do Claude ou do ChatGPT, por linguagem natural.</p>
    <section className="reference-panel"><header><Icon name="CirclePlay"/><div><h2>Como funciona, em 2 minutos</h2><p>Do conector instalado ao primeiro pedido feito pela conversa.</p></div></header><div className="reference-panel-body"><Button disabled icon="Play">Ver o vídeo</Button></div></section>
    <section className="reference-panel"><header><Icon name="Bot"/><div><h2>Claude e ChatGPT</h2><p>Consultar contatos, execuções e métricas e preparar cadências, qualificações, públicos e rascunhos de resposta sem sair da conversa. Nada muda antes da sua confirmação.</p></div></header>
      <div className="reference-panel-body">
        <Field label="URL DO CONECTOR"><div className="row"><input readOnly value={data?.url ?? ""} placeholder={error ? "" : "Carregando…"} aria-label="URL do conector"/>{data && <CopyButton text={data.url}/>}</div></Field>
        <div><strong className="mcp-label">LOGIN NO CONECTOR</strong><p>Abre uma tela do Prometeus Cadence: confira a conta e o workspace, escolha o que a conexão pode fazer e clique em Permitir acesso (autenticação OAuth). A conexão age com o seu papel e só vê o workspace que você escolher. Confirmar ações pelo aplicativo vem desmarcado: sem isso, cada ação preparada chega com um link para você revisar e confirmar aqui.</p></div>
        <div><strong className="mcp-label">Onde adicionar</strong><div className="field-grid">
          <div><h3>Claude</h3><p>Personalização → Conectores → Adicionar → Adicionar conector personalizado. Cole a URL acima.</p></div>
          <div><h3>ChatGPT</h3><p>Configurações → Aplicativos e conectores → Criar, com a URL acima e autenticação OAuth.</p></div></div></div>
        <Notice>Já tinha tentado conectar antes e deu erro? Remova o conector e adicione de novo: liberar o acesso não reconecta um conector que já existia.</Notice>
      </div></section>
    <section className="reference-panel"><header><Icon name="Shield"/><div><h2>Conexões autorizadas</h2><p>Quem conectou o Claude, o ChatGPT ou outro cliente a este workspace. Revogar corta o acesso na hora.</p></div></header>
      <div className="reference-panel-body">
        {error && <div role="alert"><Notice tone="error">{error} <button type="button" className="text-button" onClick={load}>Tentar de novo</button></Notice></div>}
        {!data ? !error && <p role="status" className="muted">Carregando conexões…</p>
        : !data.connections.length ? <p className="muted">Nenhuma conexão ainda. Quando alguém permitir o acesso, ela aparece aqui.</p>
        : <ul className="mcp-connections">{data.connections.map(c => <li key={c.id}><div><strong>{c.clientName}</strong><small className="muted">{c.mine ? "Autorizada por você" : `Autorizada por ${c.userName ?? "outro membro"}`} · {when(c.createdAt)} · {c.lastUsedAt ? `último uso ${when(c.lastUsedAt)}` : "ainda não usada"}</small><small>{c.scopes.map(s => s.label).join(" · ")}</small></div><Button variant="ghost" onClick={() => setRevoke(c)}>Revogar</Button></li>)}</ul>}
      </div></section>
    <section className="reference-panel"><header><Icon name="MessageSquare"/><div><h2>Comece por aqui: pedidos prontos</h2><p>Cole no Claude ou no ChatGPT e troque o que está entre colchetes. Pedidos que mudam algo só preparam: você revisa e confirma antes.</p></div></header>
      <div className="reference-prompt-grid">{ready.map(p => <div key={p.title}><strong>{p.title}</strong><p>{p.text}</p><CopyButton text={p.text}/></div>)}
        {later.map(t => <div key={t}><strong>{t}</strong><p className="muted">Ainda não disponível pelo conector.</p></div>)}</div></section>
    {revoke && <Modal title="Revogar a conexão?" onClose={() => !busy && setRevoke(null)}><div className="stack"><p><strong>{revoke.clientName}</strong> perde o acesso a este workspace na hora. Para voltar a usar, conecte de novo pelo aplicativo.</p><div className="form-actions"><Button disabled={busy} onClick={() => setRevoke(null)}>Cancelar</Button><Button variant="danger" disabled={busy} onClick={doRevoke}>Revogar</Button></div></div></Modal>}
  </div>;
}
