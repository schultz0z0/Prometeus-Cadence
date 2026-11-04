"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveRefresh } from "@/client/use-live-refresh";
import { whatsappBlocker } from "@/client/whatsapp-copy";
import { Badge, Button, Field, LinkButton, Notice } from "@/components/ui/primitives";
import { useConnectorApi } from "@/modules/settings/apollo-connection";
// 07B.2: the agent inside the WhatsApp inbox: the draft waiting for a person, take over and resume. No parallel SDR chat.
type Turn = { id: string; state: string; text: string | null; fields: { field: string; value: string }[]; reason: string | null };
type View = { agent: { name: string; withinHours: boolean; inService: boolean } | null; owner: "agent" | "human"; revision: number; turn: Turn | null };
type Prepared = { review: { token: string; preview: string; blockers: string[] } };
const reasons: Record<string, string> = { SDR_QUOTA: "A franquia do Agente SDR acabou. Responda você mesmo ou aguarde a renovação.", DAILY_LIMIT: "O agente chegou ao limite de respostas de hoje.", AI_UNAVAILABLE: "A IA não está disponível agora.", AI_FAILED: "A IA não respondeu a tempo.", WORKER_LOST: "O processamento foi interrompido.", EMPTY_REPLY: "A IA não conseguiu escrever uma resposta." };
export function SdrConversationControls({ conversationId, onSent }: { conversationId: string; onSent: () => Promise<void> }) {
  const api = useConnectorApi(), [view, setView] = useState<View | null>(null), [text, setText] = useState(""), [prepared, setPrepared] = useState<Prepared | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), request = useRef("");
  const shownTurn = useRef("");
  const load = useCallback(async () => {
    const v = await api<View>("/api/sdr/conversations/" + encodeURIComponent(conversationId)); setView(v);
    // A new draft fills the box once; polling never overwrites what the person is editing.
    if (v.turn?.state === "pending-approval" && shownTurn.current !== v.turn.id) { shownTurn.current = v.turn.id; setText(v.turn.text ?? ""); setPrepared(null); }
  }, [api, conversationId]);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  useLiveRefresh(async () => { await load(); }, 5000, true, conversationId);
  async function act(fn: () => Promise<void>) { setBusy(true); setError(""); try { await fn(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  if (!view || (!view.agent && !view.turn)) return error ? <div role="alert"><Notice tone="error">{error}</Notice></div> : null;
  const t = view.turn, post = (action: string, body: unknown) => api(`/api/sdr/conversations/${conversationId}/${action}`, body);
  const human = view.owner === "human", label = view.agent?.name ?? "Agente SDR";
  return <section className="reply-composer stack sdr-controls" aria-label="Agente SDR nesta conversa">
    <div className="row between wrap"><h3>{label}</h3><div className="row"><Badge tone={human ? "neutral" : "green"}>{human ? "Com você" : "Com o agente"}</Badge>
      {human ? view.agent && <Button disabled={busy} onClick={() => act(() => post("resume", { expectedRevision: view.revision }) as Promise<void>)}>Devolver ao agente</Button>
        : <Button disabled={busy} onClick={() => act(async () => { await post("takeover", { expectedRevision: view.revision }); setPrepared(null); })}>Assumir conversa</Button>}</div></div>
    {!human && view.agent && !view.agent.inService && <Notice tone="warning">O agente está parado nesta conversa: o canal, o plano, o contexto ou o conhecimento mudou. <LinkButton href="/sdr">Revisar a ativação</LinkButton></Notice>}
    {!human && view.agent?.inService && !view.agent.withinHours && <p className="muted">Fora do horário do agente: a próxima resposta é preparada quando o horário abrir.</p>}
    {t?.state === "claimed" && <p role="status" className="muted">O agente está preparando uma resposta…</p>}
    {t?.state === "handed-off" && <Notice>O agente passou esta conversa para o seu time.{t.text ? ` Sugestão dele: “${t.text}”` : ""}</Notice>}
    {t?.state === "abstained" && <Notice>O agente preferiu não responder esta mensagem. Ela fica com você.</Notice>}
    {t?.state === "blocked" && <Notice tone="warning">{reasons[t.reason ?? ""] ?? "O agente não pôde preparar uma resposta."}</Notice>}
    {t?.state === "uncertain" && <Notice tone="warning">{reasons[t.reason ?? ""] ?? "Não foi possível preparar a resposta."} {!human && view.agent?.inService && <button type="button" className="text-button" disabled={busy} onClick={() => act(() => post("retry", { turnId: t.id }) as Promise<void>)}>Tentar de novo</button>}</Notice>}
    {t?.state === "sent" && <p className="muted">Última resposta do agente aprovada e enviada para a fila.</p>}
    {t?.state === "pending-approval" && <div className="stack">
      <Field label="Rascunho do agente: nada sai sem o seu ok"><textarea rows={4} maxLength={4096} value={text} disabled={busy} onChange={e => { setText(e.target.value); setPrepared(null); }} /></Field>
      {!!t.fields.length && <p className="muted">Respostas do script: {t.fields.map(f => `${f.field}: ${f.value}`).join(" · ")}</p>}
      {prepared ? <><div className="message-preview">{prepared.review.preview}</div>{prepared.review.blockers.map(b => <p role="alert" key={b}>{whatsappBlocker(b)}</p>)}
        <div className="form-actions"><Button disabled={busy} onClick={() => setPrepared(null)}>Voltar</Button><Button variant="primary" disabled={busy || prepared.review.blockers.length > 0} onClick={() => act(async () => { await post("approve-reply", { turnId: t.id, text, reviewToken: prepared.review.token, requestId: request.current }); setPrepared(null); await onSent(); })}>{busy ? "Aprovando…" : "Aprovar e enviar"}</Button></div></>
        : <div className="form-actions"><Button disabled={busy} onClick={() => act(() => post("reject-reply", { turnId: t.id }) as Promise<void>)}>Rejeitar</Button><Button variant="primary" disabled={busy || !text.trim()} onClick={() => act(async () => { request.current = crypto.randomUUID(); setPrepared(await post("prepare-reply", { turnId: t.id, text }) as Prepared); })}>Revisar resposta</Button></div>}
    </div>}
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
  </section>;
}
