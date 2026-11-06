"use client";
import { SelectField } from "@/components/ui/select-field";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveRefresh } from "@/client/use-live-refresh";
import { whatsappBlocker } from "@/client/whatsapp-copy";
import { Badge, Button, Field, LinkButton, Notice } from "@/components/ui/primitives";
import { useConnectorApi } from "@/modules/settings/apollo-connection";
// 07B.2: the agent inside the WhatsApp inbox: the draft waiting for a person, take over and resume. No parallel SDR chat.
type Turn = { id: string; state: string; text: string | null; fields: { field: string; value: string }[]; reason: string | null; proposal: { kind: "calendar-options" } | { kind: "followup-consent"; quote: string } | null; followupAttempt: number };
type Booking = { id: string; start: string; end: string; state: string; revision: number; timezone: string };
type Followup = { id: string; quote: string; attempts: number; nextAt: string; expiresAt: string };
type View = { booking: Booking | null; followup: Followup | null; canConsent: boolean; agent: { name: string; withinHours: boolean; inService: boolean; followupAvailable: boolean } | null; owner: "agent" | "human"; revision: number; turn: Turn | null };
type Prepared = { review: { token: string; preview: string; blockers: string[] } };
const when = (iso: string, timeZone?: string) => new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone, timeZoneName: "short" } : {}) });
const reasons: Record<string, string> = { SDR_QUOTA: "A franquia do Agente SDR acabou. Responda você mesmo ou aguarde a renovação.", DAILY_LIMIT: "O agente chegou ao limite de respostas de hoje.", AI_UNAVAILABLE: "A IA não está disponível agora.", AI_FAILED: "A IA não respondeu a tempo.", WORKER_LOST: "O processamento foi interrompido.", EMPTY_REPLY: "A IA não conseguiu escrever uma resposta." };
export function SdrConversationControls({ conversationId, onSent }: { conversationId: string; onSent: () => Promise<void> }) {
  const api = useConnectorApi(), [view, setView] = useState<View | null>(null), [text, setText] = useState(""), [prepared, setPrepared] = useState<Prepared | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), request = useRef(""), [slots, setSlots] = useState<{ id: string; start: string }[] | null>(null), [pick, setPick] = useState<{ id: string; start: string; lead: string | null; blockers: string[]; token: string } | null>(null), [days, setDays] = useState(14), [confirmCancel, setConfirmCancel] = useState(false), [inserted, setInserted] = useState(false);
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
      {t.followupAttempt > 0 && <p className="muted">Retorno {t.followupAttempt} de 2, autorizado pelo contato.</p>}
      {!!t.fields.length && <p className="muted">Respostas do script: {t.fields.map(f => `${f.field}: ${f.value}`).join(" · ")}</p>}
      {prepared ? <><div className="message-preview">{prepared.review.preview}</div>{prepared.review.blockers.map(b => <p role="alert" key={b}>{whatsappBlocker(b)}</p>)}
        <div className="form-actions"><Button disabled={busy} onClick={() => setPrepared(null)}>Voltar</Button><Button variant="primary" disabled={busy || prepared.review.blockers.length > 0} onClick={() => act(async () => { await post("approve-reply", { turnId: t.id, text, reviewToken: prepared.review.token, requestId: request.current }); setPrepared(null); await onSent(); })}>{busy ? "Aprovando…" : "Aprovar e enviar"}</Button></div></>
        : <div className="form-actions"><Button disabled={busy} onClick={() => act(() => post("reject-reply", { turnId: t.id }) as Promise<void>)}>Rejeitar</Button><Button variant="primary" disabled={busy || !text.trim()} onClick={() => act(async () => { request.current = crypto.randomUUID(); setPrepared(await post("prepare-reply", { turnId: t.id, text }) as Prepared); })}>Revisar resposta</Button></div>}
    </div>}
    {t?.proposal?.kind === "followup-consent" && !view.followup && view.agent?.followupAvailable && t.state === "pending-approval" && <div className="stack"><p>O agente entendeu que o contato pediu para ser procurado depois, por este trecho: <strong>“{t.proposal.quote}”</strong>. Confira a mensagem completa acima antes de registrar: vale como autorização de atendimento neste número.</p>
      {!view.canConsent ? <p className="muted">Só proprietário ou administrador registra autorizações.</p> : <>
      <div className="row wrap"><label className="row">Vale por <SelectField aria-label="Vale por" value={days} disabled={busy} onChange={e => setDays(Number(e.target.value))}>{[7, 14, 30].map(d => <option key={d} value={d}>{d} dias</option>)}</SelectField></label>
        <Button disabled={busy} onClick={() => { const quote = (t.proposal as { quote: string }).quote; act(async () => { await post("followup-record", { turnId: t.id, quote, days }); setPrepared(null); }); }}>Registrar autorização</Button></div>
      <p className="muted">Até 2 retornos, com pelo menos 24 horas entre eles. Cada um é um rascunho que espera o seu ok; param se o contato escrever, pedir para sair, você assumir ou rejeitar um retorno.</p></>}</div>}
    {view.followup && <p className="muted">Retorno autorizado até {when(view.followup.expiresAt)} ({view.followup.attempts} de 2): “{view.followup.quote}”. <button type="button" className="text-button" disabled={busy} onClick={() => act(async () => { await post("followup-revoke", { id: view.followup!.id }); setPrepared(null); })}>Retirar</button></p>}
    <div className="stack sdr-meeting">
      {t?.proposal?.kind === "calendar-options" && !view.booking && !slots && <p>O contato quer marcar uma reunião.</p>}
      {view.booking?.state === "accepted" && <p><strong>Reunião marcada</strong> para {when(view.booking.start, view.booking.timezone)}. {t?.state === "pending-approval" && <button type="button" className="text-button" onClick={() => { setText(x => x + (x ? "\n" : "") + `Reunião confirmada para ${when(view.booking!.start, view.booking!.timezone)}.`); setInserted(true); setPrepared(null); }}>Inserir no rascunho</button>}</p>}
      {inserted && view.booking?.state !== "accepted" && t?.state === "pending-approval" && <Notice tone="warning">O rascunho cita uma reunião que não está mais marcada. Revise o texto antes de aprovar.</Notice>}
      {(view.booking?.state === "uncertain" || view.booking?.state === "prepared") && <Notice tone="warning">Não tivemos resposta da agenda para {when(view.booking.start, view.booking.timezone)}: a reunião pode ter sido criada. <button type="button" className="text-button" disabled={busy} onClick={() => act(async () => { await post("recheck-booking", {}); })}>Verificar de novo</button></Notice>}
      {(view.booking?.state === "accepted" || view.booking?.state === "uncertain") && Date.parse(view.booking.end) > Date.now() ? (confirmCancel ? <div className="stack"><p>Cancelar apaga o evento da agenda conectada. O contato não é avisado por aqui.</p><div className="form-actions"><Button disabled={busy} onClick={() => setConfirmCancel(false)}>Manter reunião</Button><Button variant="danger" disabled={busy} onClick={() => act(async () => { await post("cancel-booking", { reservationId: view.booking!.id, expectedRevision: view.booking!.revision }); setConfirmCancel(false); setSlots(null); })}>Cancelar reunião</Button></div></div> : <div><Button disabled={busy} onClick={() => setConfirmCancel(true)}>Cancelar reunião</Button></div>)
        : pick ? <div className="stack"><p>Reunião com <strong>{pick.lead ?? "contato sem vínculo"}</strong> em <strong>{when(pick.start)}</strong>. Ela entra na agenda Google conectada ao workspace, sem convite ao contato.</p>{pick.blockers.map(b => <p role="alert" key={b}>{b}</p>)}
          <div className="form-actions"><Button disabled={busy} onClick={() => setPick(null)}>Voltar</Button><Button variant="primary" disabled={busy || pick.blockers.length > 0} onClick={() => act(async () => { try { await post("confirm-booking", { slotId: pick.id, token: pick.token, requestId: crypto.randomUUID() }); } finally { setPick(null); setSlots(null); } })}>{busy ? "Marcando…" : "Confirmar reunião"}</Button></div></div>
        : slots ? <div className="stack">{slots.length ? <div className="row wrap">{slots.slice(0, 8).map(s => <Button key={s.id} disabled={busy} onClick={() => act(async () => { const r = await post("prepare-booking", { slotId: s.id }) as { lead: string | null; blockers: string[]; token: string }; setPick({ id: s.id, start: s.start, ...r }); })}>{when(s.start)}</Button>)}</div> : <p className="muted">Sem horários livres nos próximos dias.</p>}<div><Button variant="ghost" disabled={busy} onClick={() => setSlots(null)}>Fechar horários</Button></div></div>
        : <div><Button disabled={busy} onClick={() => act(async () => { const r = await post("slots", {}) as { slots: { id: string; start: string }[] }; setSlots(r.slots); })}>Ver horários da agenda</Button></div>}
    </div>
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
  </section>;
}
