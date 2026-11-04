"use client";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Badge, Button, Field, LinkButton, Modal, Notice } from "@/components/ui/primitives";
import { useConnectorApi } from "@/modules/settings/apollo-connection";
import { defaultSdrDraft, type SdrDraft } from "@/domain/sdr-policy";
import { SdrOverview } from "@/modules/settings/sdr-overview";
// 07B.1: own contract for the SDR configuration (the reference's operational screens were never observed). It follows the
// reference's four blocks: definition, qualification script, channel connection and handoff rules.
type Agent = { id: string; revision: number; state: "draft" | "active" | "paused"; name: string; draft: SdrDraft; activeRevision: number | null; activatedAt: string | null; pausedAt: string | null; pendingChanges: boolean };
type Knowledge = { id: string; revision: number; kind: "faq" | "note"; title: string; body: string; state: "draft" | "approved" | "archived" };
type Channel = { id: string; name: string; channel: string; provider: string; agentId: string | null; agentName: string | null; ready: boolean };
type View = { entitled: boolean; canManage: boolean; agents: Agent[]; channels: Channel[]; members: { id: string; name: string }[]; knowledge: Knowledge[]; context: { approved: boolean }; simulationsLeft: number };
type Review = { revision: number; summary: { name: string; channels: { id: string; name: string; provider: string }[]; hours: SdrDraft["hours"]; maxRepliesPerDay: number; approvalMode: string; questions: number; handoff: { member: string | null; rules: number }; knowledge: number }; blockers: string[]; warnings: string[]; token: string };
const stateLabel = { draft: ["Rascunho", "neutral"], active: ["Ativo", "green"], paused: ["Pausado", "orange"] } as const;
const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const zones = ["America/Sao_Paulo", "America/Manaus", "America/Belem", "America/Fortaleza", "America/Recife", "America/Cuiaba", "America/Rio_Branco", "America/Noronha"];
// Key-sorted, so the server's jsonb key order does not count as an edit.
const canon = (v: unknown): string => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}" : JSON.stringify(v);
const providerLabel: Record<string, string> = { meta: "WhatsApp oficial", twilio: "WhatsApp Twilio", openwa: "WhatsApp gerenciado" };
export function SdrArea() {
  const api = useConnectorApi(), [view, setView] = useState<View | null>(null), [error, setError] = useState(""), [open, setOpen] = useState<string | "new" | null>(null);
  const load = useCallback(() => { setError(""); api<View>("/api/sdr/agents").then(setView).catch(e => setError(e.message)); }, [api]);
  useEffect(load, [load]);
  if (error && !view) return <div className="reference-settings"><div role="alert"><Notice tone="error">{error} <button type="button" className="text-button" onClick={load}>Tentar de novo</button></Notice></div></div>;
  if (!view) return <div className="reference-settings"><p role="status" className="muted">Carregando o Agente SDR…</p></div>;
  // Without Pro, existing agents stay listed so an owner can still pause them.
  if (!view.entitled && !view.agents.length) return <SdrOverview />;
  const agent = open && open !== "new" ? view.agents.find(a => a.id === open) ?? null : null;
  return <div className="reference-settings sdr-config">
    <h1>Agente SDR</h1>
    <p className="subtitle">Monte o agente que responde quem escreve no seu número, qualifica e passa para o seu time.</p>
    {!view.entitled && <Notice tone="warning">Este workspace não está no plano Pro com assinatura ativa: os agentes não podem ser editados nem ativados, só pausados.</Notice>}
    <Notice>A cada mensagem recebida no WhatsApp, um agente ativo prepara um rascunho e espera o seu ok na caixa de mensagens. Nada sai sem a sua aprovação.</Notice>
    <PendingPanel />
    {!view.context.approved && <Notice tone="warning">O contexto da empresa ainda não foi aprovado. O agente usa esse contexto para falar em nome da sua empresa. <LinkButton href="/settings/context">Revisar contexto</LinkButton></Notice>}
    {open ? <AgentEditor key={open} view={view} agent={agent} onClose={() => setOpen(null)} onSaved={a => { setView(v => v && ({ ...v, agents: v.agents.some(x => x.id === a.id) ? v.agents.map(x => x.id === a.id ? a : x) : [...v.agents, a] })); setOpen(a.id); load(); }} onReload={load} />
      : <section className="reference-panel"><header><Icon name="Headphones" /><div><h2>Agentes</h2><p>Cada agente atende os canais que você escolher, no horário e com as regras dele.</p></div></header>
        <div className="reference-panel-body">
          {!view.agents.length ? <p className="muted">Nenhum agente ainda. Comece pela definição: quem ele é, o que oferece e o tom.</p>
            : <ul className="sdr-agent-list">{view.agents.map(a => <li key={a.id}><div><strong>{a.name}</strong><small className="muted">{a.draft.channelIds.length ? a.draft.channelIds.map(id => view.channels.find(c => c.id === id)?.name ?? "canal removido").join(" · ") : "sem canal"}{a.pendingChanges ? " · alterações não ativadas" : ""}</small></div><Badge tone={stateLabel[a.state][1]}>{stateLabel[a.state][0]}</Badge><Button onClick={() => setOpen(a.id)}>Abrir</Button></li>)}</ul>}
          <div className="form-actions"><Button variant="primary" icon="Plus" onClick={() => setOpen("new")}>Novo agente</Button></div>
        </div></section>}
    <KnowledgePanel view={view} onChange={load} />
  </div>;
}
function PendingPanel() {
  const api = useConnectorApi(), [items, setItems] = useState<{ id: string; conversationId: string; state: string; text: string | null; contact: string }[] | null>(null);
  useEffect(() => { api<{ items: NonNullable<typeof items> }>("/api/sdr/conversations").then(r => setItems(r.items)).catch(() => setItems([])); }, [api]);
  if (!items?.length) return null;
  return <section className="reference-panel"><header><Icon name="MessageSquare" /><div><h2>Aguardando seu ok</h2><p>Rascunhos do agente que ainda não saíram. A aprovação acontece na própria conversa.</p></div></header><div className="reference-panel-body">
    <ul className="sdr-agent-list">{items.map(t => <li key={t.id}><div><strong>{t.contact}</strong><small className="muted">{t.state === "uncertain" ? "A IA não respondeu: tente de novo ou assuma" : (t.text ?? "").slice(0, 120)}</small></div><LinkButton href={"/messages/whatsapp?conversation=" + encodeURIComponent(t.conversationId)}>Abrir conversa</LinkButton></li>)}</ul>
  </div></section>;
}
function AgentEditor({ view, agent, onClose, onSaved, onReload }: { view: View; agent: Agent | null; onClose: () => void; onSaved: (a: Agent) => void; onReload: () => void }) {
  const api = useConnectorApi(), [d, setD] = useState<SdrDraft>(() => agent?.draft ?? { ...defaultSdrDraft(), channelIds: view.channels.filter(c => c.ready && c.channel === "WHATSAPP" && !c.agentId).slice(0, 1).map(c => c.id) });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(""), dirty = !agent || canon(agent.draft) !== canon(d);
  const set = <K extends keyof SdrDraft>(k: K, v: SdrDraft[K]) => { setSaved(""); setD(x => ({ ...x, [k]: v })); };
  async function save() { setBusy(true); setError(""); try { const a = await api<Agent>("/api/sdr/agents", { ...(agent ? { id: agent.id } : {}), expectedRevision: agent?.revision ?? 0, draft: d }); setD(a.draft); setSaved("Rascunho salvo."); onSaved(a); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const q = d.qualification;
  return <>
    <div className="row sdr-editor-head"><Button variant="ghost" icon="ArrowLeft" onClick={onClose}>Agentes</Button>{agent && <Badge tone={stateLabel[agent.state][1]}>{stateLabel[agent.state][0]}</Badge>}</div>
    <section className="reference-panel"><header><Icon name="User" /><div><h2>Definição do agente</h2><p>Quem ele é, o que oferece e o tom que usa.</p></div></header><div className="reference-panel-body">
      <Field label="Nome"><input value={d.name} maxLength={80} onChange={e => set("name", e.target.value)} /></Field>
      <Field label="Instruções" help="O agente fala em nome da sua empresa. Ele também usa o contexto aprovado da empresa."><textarea rows={5} maxLength={4000} value={d.instructions} placeholder="Ex.: Você é o Lucas, da [empresa]. Ajuda escritórios a … Tom cordial e direto." onChange={e => set("instructions", e.target.value)} /></Field>
    </div></section>
    <section className="reference-panel"><header><Icon name="ListChecks" /><div><h2>Script de qualificação</h2><p>As perguntas que decidem se o lead serve. Até 10.</p></div></header><div className="reference-panel-body">
      {q.map((x, i) => <div key={i} className="sdr-question"><Field label={`Pergunta ${i + 1}`}><input value={x.question} maxLength={300} onChange={e => set("qualification", q.map((y, j) => j === i ? { ...y, question: e.target.value } : y))} /></Field>
        <Field label="Campo"><input value={x.field} maxLength={40} placeholder="ex.: porte" onChange={e => set("qualification", q.map((y, j) => j === i ? { ...y, field: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") } : y))} /></Field>
        <label className="checkbox-row"><input type="checkbox" checked={x.required} onChange={e => set("qualification", q.map((y, j) => j === i ? { ...y, required: e.target.checked } : y))} /><span>Obrigatória</span></label>
        <Button variant="ghost" aria-label={`Remover pergunta ${i + 1}`} icon="Trash2" onClick={() => set("qualification", q.filter((_, j) => j !== i))} /></div>)}
      {q.length < 10 && <div><Button icon="Plus" onClick={() => set("qualification", [...q, { question: "", field: `campo_${q.length + 1}`, required: false }])}>Adicionar pergunta</Button></div>}
    </div></section>
    <section className="reference-panel"><header><Icon name="MessageSquare" /><div><h2>Conexão do canal</h2><p>O número de WhatsApp por onde ele responde. Só canais prontos para enviar e receber.</p></div></header><div className="reference-panel-body">
      {!view.channels.length ? <p className="muted">Nenhum canal conectado. <LinkButton href="/settings/whatsapp">Conectar WhatsApp</LinkButton></p>
        : null}
      {d.channelIds.filter(id => !view.channels.some(c => c.id === id)).map(id => <label key={id} className="checkbox-row"><input type="checkbox" checked onChange={() => set("channelIds", d.channelIds.filter(x => x !== id))} /><span>Canal removido <small className="muted">· desmarque para tirar do agente</small></span></label>)}
      {view.channels.map(c => { const taken = c.agentId && c.agentId !== agent?.id; return <label key={c.id} className="checkbox-row"><input type="checkbox" disabled={(!c.ready || !!taken) && !d.channelIds.includes(c.id)} checked={d.channelIds.includes(c.id)} onChange={e => set("channelIds", e.target.checked ? [...d.channelIds, c.id].slice(0, 5) : d.channelIds.filter(x => x !== c.id))} />
          <span>{c.name} <small className="muted">· {providerLabel[c.provider] ?? (c.channel === "EMAIL" ? "E-mail" : c.provider)}{!c.ready ? " · não está pronto" : ""}{taken ? ` · atendido por ${c.agentName}` : ""}</small></span></label>; })}
      {view.channels.some(c => c.provider === "openwa" && d.channelIds.includes(c.id)) && <Notice>No WhatsApp gerenciado o limite é de 20 respostas por dia, somadas aos outros envios do número.</Notice>}
    </div></section>
    <section className="reference-panel"><header><Icon name="Headphones" /><div><h2>Regras de passagem</h2><p>Quando o agente para e transfere a conversa para o seu time.</p></div></header><div className="reference-panel-body">
      <Field label="Responsável"><select value={d.handoff.memberId} onChange={e => set("handoff", { ...d.handoff, memberId: e.target.value })}><option value="">Escolha um membro</option>{view.members.map(m => <option key={m.id} value={m.id}>{m.name || "Sem nome"}</option>)}</select></Field>
      <Field label="Regras (uma por linha)" help="Ex.: pediu proposta fechada; reclamou; perguntou algo que não está na base."><textarea rows={4} value={d.handoff.rules.join("\n")} onChange={e => set("handoff", { ...d.handoff, rules: e.target.value.split("\n").map(s => s.slice(0, 200)).slice(0, 10) })} onBlur={() => set("handoff", { ...d.handoff, rules: d.handoff.rules.map(s => s.trim()).filter(Boolean) })} /></Field>
    </div></section>
    <section className="reference-panel"><header><Icon name="Clock" /><div><h2>Horário e limites</h2><p>Fora do horário, o agente não prepara respostas.</p></div></header><div className="reference-panel-body">
      <div className="field-grid">
        <Field label="Fuso horário"><select value={d.hours.timezone} onChange={e => set("hours", { ...d.hours, timezone: e.target.value })}>{zones.map(z => <option key={z}>{z}</option>)}</select></Field>
        <Field label="Respostas por dia" help="Até 200; no WhatsApp gerenciado, até 20."><input type="number" min={1} max={200} value={d.maxRepliesPerDay} onChange={e => set("maxRepliesPerDay", Math.max(1, Math.min(200, Number(e.target.value) || 1)))} /></Field>
      </div>
      <div className="sdr-days" role="group" aria-label="Dias de atendimento">{days.map((n, i) => <label key={n} className="checkbox-row"><input type="checkbox" checked={d.hours.weekdays.includes(i)} onChange={e => set("hours", { ...d.hours, weekdays: e.target.checked ? [...d.hours.weekdays, i].sort() : d.hours.weekdays.filter(x => x !== i) })} /><span>{n}</span></label>)}</div>
      <label className="checkbox-row"><input type="checkbox" checked={d.hours.allDay} onChange={e => set("hours", { ...d.hours, allDay: e.target.checked })} /><span>24 horas nos dias marcados</span></label>
      {!d.hours.allDay && <div className="field-grid"><Field label="Início"><input type="time" value={d.hours.start} onChange={e => set("hours", { ...d.hours, start: e.target.value })} /></Field><Field label="Fim"><input type="time" value={d.hours.end} onChange={e => set("hours", { ...d.hours, end: e.target.value })} /></Field></div>}
      <Field label="Aprovação das respostas"><select value={d.approvalMode} onChange={e => set("approvalMode", e.target.value as SdrDraft["approvalMode"])}><option value="all">Pedir o meu ok antes de cada resposta</option><option value="bounded-auto">Responder sozinho o que estiver na base aprovada (depois do piloto)</option></select></Field>
      <label className="checkbox-row"><input type="checkbox" checked={d.followupEnabled} onChange={e => set("followupEnabled", e.target.checked)} /><span>Follow-up para quem não respondeu <small className="muted">(ainda não disponível)</small></span></label>
    </div></section>
    <section className="reference-panel"><header><Icon name="BookOpen" /><div><h2>Base de conhecimento deste agente</h2><p>Só os itens aprovados podem ir para um agente ativo.</p></div></header><div className="reference-panel-body">
      {!view.knowledge.length && <p className="muted">Nenhum item na base. Adicione abaixo, em Base de conhecimento.</p>}
      {d.knowledgeIds.filter(id => !view.knowledge.some(k => k.id === id)).map(id => <label key={id} className="checkbox-row"><input type="checkbox" checked onChange={() => set("knowledgeIds", d.knowledgeIds.filter(x => x !== id))} /><span>Item arquivado <small className="muted">· desmarque para tirar do agente</small></span></label>)}
      {view.knowledge.map(k => <label key={k.id} className="checkbox-row"><input type="checkbox" checked={d.knowledgeIds.includes(k.id)} onChange={e => set("knowledgeIds", e.target.checked ? [...d.knowledgeIds, k.id] : d.knowledgeIds.filter(x => x !== k.id))} /><span>{k.title} <small className="muted">· {k.kind === "faq" ? "pergunta frequente" : "nota"} · {k.state === "approved" ? "aprovado" : "rascunho"}</small></span></label>)}
    </div></section>
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
    {saved && <p role="status" className="muted">{saved}</p>}
    <div className="form-actions"><Button onClick={onClose} disabled={busy}>Voltar</Button><Button variant="primary" disabled={busy || !dirty} onClick={save}>{busy ? "Salvando…" : "Salvar rascunho"}</Button></div>
    {agent && <><Simulation agent={agent} left={view.simulationsLeft} dirty={dirty} onDone={onReload} /><Activation agent={agent} canManage={view.canManage} dirty={dirty} onDone={onReload} /></>}
  </>;
}
function Simulation({ agent, left, dirty, onDone }: { agent: Agent; left: number; dirty: boolean; onDone: () => void }) {
  const api = useConnectorApi(), [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [out, setOut] = useState<{ reply: string; decision: string; fields: { field: string; value: string }[]; remaining: number } | null>(null);
  async function run() { setBusy(true); setError(""); try { setOut(await api(`/api/sdr/agents/${agent.id}/simulate`, { incoming: text })); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <section className="reference-panel"><header><Icon name="Sparkles" /><div><h2>Simular uma conversa</h2><p>Escreva o que um lead mandaria e veja a resposta do agente com o rascunho salvo. Nada é enviado.</p></div></header><div className="reference-panel-body">
    <Field label="Mensagem do lead" help={`${out?.remaining ?? left} simulações restantes hoje neste workspace.`}><textarea rows={3} maxLength={1000} value={text} placeholder="Ex.: Oi, quanto custa?" onChange={e => setText(e.target.value)} /></Field>
    {dirty && <p className="muted">Salve o rascunho para simular com as alterações.</p>}
    <div className="form-actions"><Button variant="primary" disabled={busy || !text.trim()} onClick={run}>{busy ? "Simulando…" : "Simular"}</Button></div>
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
    {out && <div className="sdr-sim-result" aria-live="polite"><small>{out.decision === "handoff" ? "PASSARIA PARA O SEU TIME" : out.decision === "abstain" ? "NÃO RESPONDERIA" : "RESPOSTA SUGERIDA"} · simulação, não enviada</small><p>{out.reply || "—"}</p>
      {!!out.fields.length && <dl>{out.fields.map(f => <div key={f.field}><dt>{f.field}</dt><dd>{f.value}</dd></div>)}</dl>}</div>}
  </div></section>;
}
function Activation({ agent, canManage, dirty, onDone }: { agent: Agent; canManage: boolean; dirty: boolean; onDone: () => void }) {
  const api = useConnectorApi(), [review, setReview] = useState<Review | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [pause, setPause] = useState(false), [requestId, setRequestId] = useState("");
  async function act(fn: () => Promise<void>) { setBusy(true); setError(""); try { await fn(); } catch (e) { setError((e as Error).message); setReview(null); } finally { setBusy(false); } }
  const s = review?.summary;
  return <section className="reference-panel"><header><Icon name="Zap" /><div><h2>Ativação</h2><p>Você revisa canais, horário, limites e aprovação antes de ligar. O agente nasce pedindo o seu ok antes de cada resposta.</p></div></header><div className="reference-panel-body">
    {agent.state === "active" && <p><strong>Ativo</strong> desde {new Date(agent.activatedAt!).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.{agent.pendingChanges ? " Há alterações salvas que ainda não foram ativadas." : ""}</p>}
    {agent.state === "paused" && <p><strong>Pausado.</strong> Para voltar, revise e ative de novo.</p>}
    {!canManage ? <p className="muted">Só proprietário ou administrador ativa e pausa o agente.</p> : dirty ? <p className="muted">Salve o rascunho antes de revisar a ativação.</p>
      : review && s ? <div className="sdr-review">
        <dl className="mcp-consent-who"><dt>Agente</dt><dd>{s.name}</dd><dt>Canais</dt><dd>{s.channels.map(c => c.name).join(", ") || "—"}</dd>
          <dt>Horário</dt><dd>{s.hours.weekdays.map(i => days[i]).join(", ")} · {s.hours.allDay ? "24 horas" : `${s.hours.start}–${s.hours.end}`} · {s.hours.timezone}</dd>
          <dt>Limite</dt><dd>{s.maxRepliesPerDay} respostas por dia</dd><dt>Aprovação</dt><dd>{s.approvalMode === "all" ? "o seu ok antes de cada resposta" : "resposta automática na base aprovada"}</dd>
          <dt>Script</dt><dd>{s.questions} perguntas</dd><dt>Passagem</dt><dd>{s.handoff.member ?? "sem responsável"} · {s.handoff.rules} regras</dd><dt>Conhecimento</dt><dd>{s.knowledge} itens</dd></dl>
        {review.warnings.map(w => <p key={w} className="muted">{w}</p>)}
        {review.blockers.map(b => <p key={b} role="alert" className="auth-error">{b}</p>)}
        <div className="form-actions"><Button disabled={busy} onClick={() => setReview(null)}>Voltar</Button><Button variant="primary" disabled={busy || review.blockers.length > 0} onClick={() => act(async () => { await api(`/api/sdr/agents/${agent.id}/confirm-activate`, { revision: review.revision, token: review.token, requestId }); setReview(null); onDone(); })}>{busy ? "Ativando…" : "Ativar agente"}</Button></div>
      </div>
      : <div className="form-actions">{agent.state === "active" && <Button disabled={busy} onClick={() => setPause(true)}>Pausar</Button>}{(agent.state !== "active" || agent.pendingChanges) && <Button variant="primary" disabled={busy} onClick={() => act(async () => { setRequestId(crypto.randomUUID()); setReview(await api<Review>(`/api/sdr/agents/${agent.id}/prepare-activate`, { revision: agent.revision })); })}>{busy ? "Revisando…" : agent.state === "active" ? "Revisar e ativar alterações" : "Revisar ativação"}</Button>}</div>}
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
    {pause && <Modal title="Pausar o agente?" onClose={() => !busy && setPause(false)}><div className="stack"><p>O agente deixa de estar ativo nos canais dele. Para voltar, você revisa e ativa de novo.</p><div className="form-actions"><Button disabled={busy} onClick={() => setPause(false)}>Cancelar</Button><Button variant="danger" disabled={busy} onClick={() => act(async () => { await api(`/api/sdr/agents/${agent.id}/pause`, { expectedRevision: agent.revision }); setPause(false); onDone(); })}>Pausar</Button></div></div></Modal>}
  </div></section>;
}
function KnowledgePanel({ view, onChange }: { view: View; onChange: () => void }) {
  const api = useConnectorApi(), [edit, setEdit] = useState<Partial<Knowledge> | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function act(fn: () => Promise<unknown>) { setBusy(true); setError(""); try { await fn(); setEdit(null); onChange(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <section className="reference-panel"><header><Icon name="BookOpen" /><div><h2>Base de conhecimento</h2><p>Perguntas frequentes e notas que o agente pode usar. É privada deste workspace e entra como informação, nunca como ordem.</p></div></header><div className="reference-panel-body">
    {!view.knowledge.length && !edit && <p className="muted">Nenhum item ainda.</p>}
    {!!view.knowledge.length && <ul className="sdr-agent-list">{view.knowledge.map(k => <li key={k.id}><div><strong>{k.title}</strong><small className="muted">{k.kind === "faq" ? "Pergunta frequente" : "Nota"} · {k.body.slice(0, 120)}{k.body.length > 120 ? "…" : ""}</small></div>
      <Badge tone={k.state === "approved" ? "green" : "neutral"}>{k.state === "approved" ? "Aprovado" : "Rascunho"}</Badge>
      <div className="row">{k.state !== "approved" && view.canManage && <Button disabled={busy} onClick={() => act(() => api(`/api/sdr/knowledge/${k.id}/state`, { expectedRevision: k.revision, state: "approved" }))}>Aprovar</Button>}
        <Button variant="ghost" disabled={busy} onClick={() => setEdit(k)}>Editar</Button><Button variant="ghost" disabled={busy} onClick={() => act(() => api(`/api/sdr/knowledge/${k.id}/state`, { expectedRevision: k.revision, state: "archived" }))}>Arquivar</Button></div></li>)}</ul>}
    {edit ? <div className="stack">
      <div className="field-grid"><Field label="Tipo"><select value={edit.kind ?? "faq"} onChange={e => setEdit({ ...edit, kind: e.target.value as Knowledge["kind"] })}><option value="faq">Pergunta frequente</option><option value="note">Nota</option></select></Field>
        <Field label="Título"><input maxLength={120} value={edit.title ?? ""} onChange={e => setEdit({ ...edit, title: e.target.value })} /></Field></div>
      <Field label="Texto" help="Editar volta o item para rascunho: ele precisa de nova aprovação."><textarea rows={4} maxLength={4000} value={edit.body ?? ""} onChange={e => setEdit({ ...edit, body: e.target.value })} /></Field>
      <div className="form-actions"><Button disabled={busy} onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" disabled={busy || !edit.title?.trim() || !edit.body?.trim()} onClick={() => act(() => api("/api/sdr/knowledge", { ...(edit.id ? { id: edit.id } : {}), expectedRevision: edit.revision ?? 0, kind: edit.kind ?? "faq", title: edit.title, body: edit.body }))}>Salvar</Button></div>
    </div> : <div><Button icon="Plus" onClick={() => setEdit({ kind: "faq" })}>Adicionar item</Button></div>}
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
  </div></section>;
}
