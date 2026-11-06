"use client";
import { SelectField } from "@/components/ui/select-field";
import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "@/client/workspace-provider";
import { useConnectorApi } from "./apollo-connection";
import { LINKEDIN_TERMS, type LinkedinAccountView } from "@/domain/linkedin-connection";
import { PIPELINE_COLUMNS, type LinkedinMessageView, type LinkedinPersonView, type PipelineStage } from "@/domain/linkedin-message-action";
import { type LinkedinSequenceStep, type LinkedinSequenceView, type LinkedinTemplateView } from "@/domain/linkedin-sequence";
import { COMMENT_MAX, type LinkedinApprovalView } from "@/domain/linkedin-approval";
import { defaultCampaignDraft, LINKEDIN_DAILY_CAP, type AudienceSample, type LinkedinCampaignDraft, type LinkedinCampaignView } from "@/domain/linkedin-campaign";
import { SdrOverview } from './sdr-overview';
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import {
  PageHeader,
  Button,
  LinkButton,
  Modal,
  Notice,
  Field,
  Badge,
} from "@/components/ui/primitives";
// Why LinkedIn is unavailable (07A.0 attestation) and the workspace's account (07A.1), read on the server. null = not read (demo).
export type LinkedinAvailability = { reason: string; connect: boolean; account?: LinkedinAccountView | null; returned?: string } | null;
const Availability = createContext<LinkedinAvailability>(null);
const pendingReason = "A integração LinkedIn ainda não está disponível.";
export function LinkedinSdr({
  sdr = false,
  section = "dashboard",
  availability = null,
  campaignId = null,
}: {
  sdr?: boolean;
  section?: string;
  availability?: LinkedinAvailability;
  campaignId?: string | null;
}) {
  if (!sdr) return <Availability.Provider value={availability}><LinkedinReference section={section} campaignId={campaignId} /></Availability.Provider>;
  return <SdrOverview />;
}
const campaignPath = "/linkedin/campaigns/new";
// The return query string is only a hint: "connected" is said only when the server shows the account.
const returnedCopy = (returned: string, account: LinkedinAccountView | null): [string, "success" | "info" | "error"] | undefined =>
  returned === "connected" || returned === "connecting" ? account ? ["Conta LinkedIn conectada.", "success"] : ["Login concluído. Aguardando a confirmação do fornecedor; verifique em instantes.", "info"]
  : returned === "cancelled" ? ["Conexão cancelada. Nenhuma conta foi conectada.", "info"]
  : returned === "failed" ? ["Não foi possível concluir a conexão. Tente de novo.", "error"] : undefined;
const stateLabel: Record<string, string> = { ready: "conectada", connecting: "conectando", restricted: "precisa reconectar", error: "sincronização parada", revoked: "desconectada" };
function LinkedinPrerequisites() {
  const a = useContext(Availability), router = useRouter(), [returned] = useState(a?.returned), ready = !!a?.connect, account = a?.account ?? null, done = !!account?.ready, notice = returned ? returnedCopy(returned, account) : undefined;
  // Drop the hint from the address so a reload or a shared link does not repeat it; the notice stays for this visit.
  useEffect(() => { if (a?.returned) router.replace("/linkedin/dashboard", { scroll: false }); }, [a?.returned, router]);
  return <div className="li-prerequisites">
    <small>PRA OS CONVITES SAÍREM, NESTA ORDEM</small>
    {notice && <div role="status" className="li-return-notice"><Notice tone={notice[1]}>{notice[0]}</Notice></div>}
    <ol>
      <li className={ready ? undefined : "li-next"}><span>{ready ? <Icon name="Check" size={13}/> : 1}</span><div>Disponibilizar a integração<small>{ready ? "Fornecedor do LinkedIn habilitado na plataforma" : a?.reason || "LinkedIn ainda não está disponível neste workspace"}</small></div></li>
      <li className={ready && !done ? "li-next" : undefined}><span>{done ? <Icon name="Check" size={13}/> : 2}</span><div>Conectar o seu LinkedIn{ready ? <LinkedinAccountStep account={account}/> : <small>depois do passo 1</small>}</div></li>
      <li className={done ? "li-next" : undefined}><span>3</span><div>Ligar a campanha{done ? <Link className="li-step-link" href={campaignPath}>Montar e ativar uma campanha <Icon name="ArrowRight" size={12}/></Link> : <small>depois do passo 2</small>}</div></li>
    </ol>
  </div>;
}
// Step 2: connect (terms, then the vendor's hosted login), state with the last check, check again, reconnect, disconnect.
function LinkedinAccountStep({account}: {account: LinkedinAccountView | null}) {
  const identity = useIdentity(), canManage = ["owner", "admin"].includes(identity?.workspaces.find(w => w.id === identity.activeWorkspaceId)?.role ?? "");
  const api = useConnectorApi(), router = useRouter(), [modal, setModal] = useState<"" | "connect" | "revoke">(""), [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function run(fn: () => Promise<void>) { setBusy(true); setError(""); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const connect = () => run(async () => {
    const input = { termsVersion: LINKEDIN_TERMS.version, acceptTerms: true, expectedRevision: account?.revision ?? 0 };
    const r = await api<{url: string}>(account ? `/api/linkedin/accounts/${account.id}/reconnect` : "/api/linkedin/accounts", account ? input : { action: "confirm-connect", input });
    window.location.assign(r.url);
  });
  const check = () => run(async () => { try { await api(`/api/linkedin/accounts/${account!.id}/sync`, { requestId: crypto.randomUUID() }); } finally { router.refresh(); } });
  const revoke = () => run(async () => { await api(`/api/linkedin/accounts/${account!.id}/revoke`, { expectedRevision: account!.revision }); setModal(""); router.refresh(); });
  const open = () => { setAccepted(false); setError(""); setModal("connect"); };
  return <>
    {!account ? canManage ? <button type="button" className="li-step-link" onClick={open}>Conectar o LinkedIn <Icon name="ArrowRight" size={12}/></button> : <small>Peça a um administrador para conectar o LinkedIn</small>
      : <><small>{account.displayName} · {stateLabel[account.state]} · {account.lastSyncAt ? `verificada em ${new Date(account.lastSyncAt).toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"})}` : "ainda não verificada"}</small>
        {account.attention && <small className="li-step-attention">{account.attention}</small>}
        {canManage && <span className="li-step-actions"><button type="button" className="li-step-link" disabled={busy} onClick={check}>{busy && !modal ? "Verificando…" : "Verificar agora"}</button>{!account.ready && account.state !== "connecting" && <button type="button" className="li-step-link" disabled={busy} onClick={open}>Reconectar</button>}<button type="button" className="li-step-link" disabled={busy} onClick={() => { setError(""); setModal("revoke"); }}>Desconectar</button></span>}</>}
    {error && !modal && !account?.attention?.includes(error) && <small role="alert" className="li-step-error">{error}</small>}
    {modal === "connect" && <Modal title={LINKEDIN_TERMS.title} className="li-account-modal" onClose={() => setModal("")}><div className="stack">
      <ul className="li-terms">{LINKEDIN_TERMS.items.map(item => <li key={item}>{item}</li>)}</ul>
      <label className="li-check"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/><span><strong>Li e aceito estas condições para a minha conta</strong><small>Versão {LINKEDIN_TERMS.version}. Fica registrado quem aceitou e quando.</small></span></label>
      {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
      <div className="form-actions"><Button onClick={() => setModal("")}>Cancelar</Button><Button variant="primary" disabled={!accepted || busy} onClick={connect}>{busy ? "Abrindo…" : "Continuar para o login"}</Button></div>
    </div></Modal>}
    {modal === "revoke" && <Modal title="Desconectar o LinkedIn?" className="li-account-modal" onClose={() => setModal("")}><div className="stack">
      <p>O acesso à conta para na hora e a sessão é removida do fornecedor. O histórico da conexão continua aqui.</p>
      {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
      <div className="form-actions"><Button onClick={() => setModal("")}>Cancelar</Button><Button variant="danger" disabled={busy} onClick={revoke}>{busy ? "Desconectando…" : "Desconectar"}</Button></div>
    </div></Modal>}
  </>;
}
function LinkedinReference({section, campaignId}: {section: string; campaignId: string | null}) {
  return <div className="linkedin-reference">
    {section === "dashboard" ? <LinkedinOverview /> : section === "campaigns/new" ? <LinkedinCampaignDraft campaignId={campaignId} /> : section === "campaigns" ? <LinkedinCampaigns /> : section === "enrichment" ? <LinkedinEnrichment /> : section === "cadences" ? <LinkedinCadences /> : section === "templates" ? <LinkedinTemplates /> : section === "people" ? <LinkedinPeople /> : section === "pipeline" ? <LinkedinPipeline /> : section === "approvals" ? <LinkedinApprovals /> : <LinkedinWaiting section={section} />}
  </div>;
}
function LinkedinOverview() {
  return <>
    <section className="li-panel li-overview">
      <div className="li-overview-heading"><span className="li-brand-icon"><Icon name="Linkedin" size={27}/></span><div>
        <h1>Prospecção no LinkedIn</h1>
        <p>Você fala com a pessoa certa pelo cargo, não com o e-mail genérico da empresa. Monte a sua campanha agora: a gente mostra o público de verdade e o resultado que você teria.</p>
        <LinkButton href={campaignPath} variant="primary" icon="Plus">Montar minha primeira campanha <Icon name="ArrowRight" size={15}/></LinkButton>
      </div></div>
      <LinkedinPrerequisites />
      <p className="li-footnote">{useContext(Availability)?.account?.ready ? "Convites só saem de campanhas que você revisa e ativa, até 12 por dia na sua conta." : "Você pode preparar o público e o convite. Convites só saem depois que o LinkedIn estiver conectado e a campanha for ativada."}</p>
    </section>
    <div className="li-four-grid li-process">
      {[["Users","1 · Escolha quem","Cargo, cidade e setor. A gente mostra quantas pessoas existem com essa mira e quem são as primeiras."],["Send","2 · Convite com nota","Uma nota curta, escrita por você e adaptada pela IA pra cada pessoa. Sai no ritmo seguro da sua conta."],["MessageSquare","3 · Aceitou? Conversa","Quem aceita cai numa cadência de mensagens no LinkedIn, e a resposta chega na sua caixa aqui."],["ListChecks","4 · Vira lead","Aceites entram numa lista com e-mail e telefone enriquecidos, prontos pra cadência ou pro CRM."]].map(([icon,title,body])=><section className="li-panel" key={title}><Icon name={icon} size={20}/><h2>{title}</h2><p>{body}</p></section>)}
    </div>
    <section className="li-panel li-projection"><h3><Icon name="Sparkles" size={16}/>O que você teria em 22 dias úteis <small>estimativa · 12 convites/dia</small></h3>
      <div className="li-three-grid">{[["264","Convites enviados"],["66–92","Novas conexões"],["8–18","Conversas abertas"]].map(([value,label])=><div key={label}><strong>{value}</strong><small>{label}</small></div>)}</div>
      <p className="li-footnote">Cenário ilustrativo de prospecção B2B por convite. Não são resultados do workspace nem uma promessa de desempenho.</p>
    </section>
  </>;
}
const campaignState: Record<string, [string, string]> = { draft: ["Rascunho", "neutral"], active: ["Ativa", "green"], paused: ["Pausada", "amber"], completed: ["Concluída", "neutral"], cancelled: ["Cancelada", "neutral"] };
const personCounts: [string, string][] = [["queued", "Na fila"], ["invited", "Convidados"], ["accepted", "Aceites"], ["uncertain", "Sem confirmação"], ["expired", "Expirados"], ["skipped", "Pulados"], ["failed", "Recusados"]];
function useCampaigns() {
  const api = useConnectorApi(), [items, setItems] = useState<LinkedinCampaignView[] | null>(null), [error, setError] = useState("");
  const load = () => { setError(""); api<{campaigns: LinkedinCampaignView[]}>("/api/linkedin/campaigns").then(r => setItems(r.campaigns)).catch(e => setError(e.message)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [api]);
  return {items, error, load, api};
}
function LinkedinCampaigns() {
  const identity = useIdentity(), canManage = ["owner", "admin"].includes(identity?.workspaces.find(w => w.id === identity.activeWorkspaceId)?.role ?? "");
  const {items, error, load, api} = useCampaigns(), [busy, setBusy] = useState(""), [actionError, setActionError] = useState(""), [cancel, setCancel] = useState<LinkedinCampaignView | null>(null);
  async function act(c: LinkedinCampaignView, action: string) { setBusy(c.id); setActionError(""); try { await api(`/api/linkedin/campaigns/${c.id}/${action}`, {expectedRevision: c.revision}); setCancel(null); } catch (e) { setActionError((e as Error).message); } finally { setBusy(""); load(); } }
  return <><PageHeader title="Campanhas de convite" description="A campanha só envia convite. O que acontece depois do aceite é da cadência." actions={<LinkButton href={campaignPath} variant="primary" icon="Plus">Nova campanha</LinkButton>}/>
    {error ? <Notice tone="error">{error} <button type="button" className="text-button" onClick={load}>Tentar de novo</button></Notice>
    : !items ? <p role="status" className="li-muted">Carregando campanhas…</p>
    : !items.length ? <section className="li-panel li-campaign-empty"><Icon name="Send" size={32}/><h2>Nenhuma campanha ainda</h2><p>Antes de disparar, você explora o público: roda a busca, vê quantas pessoas ela devolve e uma amostra dos perfis. Convite não volta, então errar a mira custa a cota da semana.</p><LinkButton href={campaignPath} variant="primary" icon="Plus">Criar a primeira</LinkButton></section>
    : <div className="li-campaign-list">{items.map(c => <section className="li-panel li-campaign-row" key={c.id}>
        <div><h2>{c.name}</h2><Badge tone={campaignState[c.state][1]}>{campaignState[c.state][0]}</Badge></div>
        <p className="li-campaign-counts">{personCounts.filter(([k]) => c.counts[k as keyof typeof c.counts]).map(([k, label]) => <span key={k}>{label} <strong>{c.counts[k as keyof typeof c.counts]}</strong></span>)}{!Object.keys(c.counts).length && <span>{c.state === "draft" ? "Ainda não ativada." : c.state === "active" ? "Coletando o público…" : "Nenhuma pessoa coletada."}</span>}</p>
        {c.lastError && <small className="li-step-error">{c.lastError}</small>}
        <div className="row wrap">{c.state === "draft" && <LinkButton href={`${campaignPath}?id=${c.id}`}>Editar rascunho</LinkButton>}
          {canManage && c.state === "active" && <Button disabled={busy === c.id} onClick={() => act(c, "pause")}>Pausar</Button>}
          {canManage && c.state === "paused" && <Button disabled={busy === c.id} onClick={() => act(c, "resume")}>Retomar</Button>}
          {canManage && ["draft", "active", "paused"].includes(c.state) && <Button variant="ghost" disabled={busy === c.id} onClick={() => setCancel(c)}>Cancelar</Button>}</div>
      </section>)}</div>}
    {actionError && <div role="alert"><Notice tone="error">{actionError}</Notice></div>}
    {cancel && <Modal title="Cancelar a campanha?" onClose={() => setCancel(null)}><div className="stack"><p>Nenhum convite novo sai desta campanha. Convites já enviados continuam no LinkedIn, e os aceites seguem chegando na lista.</p><div className="form-actions"><Button onClick={() => setCancel(null)}>Voltar</Button><Button variant="danger" disabled={busy === cancel.id} onClick={() => act(cancel, "cancel")}>Cancelar campanha</Button></div></div></Modal>}
  </>;
}
const waitingCopy: Record<string, {title:string;description:string;icon:string}> = {
  people: {title:"Aqui ficam as pessoas da sua prospecção", description:"Cada convidado aparece nesta lista com o estágio dele, na fila, convidado, aceitou, respondeu, e vira lead com e-mail e telefone quando aceita. Preenche assim que a sua primeira campanha ligar.",icon:"Users"},
  pipeline: {title:"Aqui fica o pipeline do LinkedIn",description:"Cada pessoa da campanha aparece na coluna do estágio dela: na fila, aquecida, convidada, aceitou, respondeu. Preenche assim que a sua primeira campanha ligar.",icon:"Columns3"},
  approvals: {title:"Comentários que a IA escreve, você aprova",description:"Quando um passo da campanha comenta num post, o texto para aqui antes de sair: você lê, ajusta e aprova. É a única ação pública do módulo, por isso ninguém publica sem a sua palavra.",icon:"MessageSquare"},
};
const approvalState: Record<string, [string, string]> = { posted: ["Publicado", "green"], uncertain: ["Sem confirmação", "amber"], failed: ["Recusado pelo LinkedIn", "red"], rejected: ["Rejeitado", "neutral"], expired: ["Venceu", "neutral"], cancelled: ["Cancelado", "neutral"], posting: ["Publicando", "amber"], pending: ["Pendente", "amber"] };
function LinkedinApprovals() {
  const api = useConnectorApi(), [tab, setTab] = useState<"pending" | "history">("pending"), [data, setData] = useState<Record<string, LinkedinApprovalView[]>>({}), [error, setError] = useState(""), [message, setMessage] = useState("");
  const load = () => { setError(""); Promise.all((["pending", "history"] as const).map(t => api<{approvals: LinkedinApprovalView[]}>(`/api/linkedin/approvals?tab=${t}`).then(r => [t, r.approvals] as const))).then(r => setData(Object.fromEntries(r))).catch(e => setError(e.message)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [api]);
  const pending = data.pending, history = data.history;
  if (pending && history && !pending.length && !history.length && !error) return <LinkedinWaiting section="approvals" />;
  return <><PageHeader title="Aprovações" description="Comentários que a IA escreve, você aprova. Nada é publicado sem a sua palavra."/>
    <div className="li-view" role="tablist" aria-label="Aprovações">{([["pending", `Pendentes${pending ? ` (${pending.length})` : ""}`], ["history", "Histórico"]] as const).map(([k, label]) => <Button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</Button>)}</div>
    {error && <div role="alert"><Notice tone="error">{error} <button type="button" className="text-button" onClick={load}>Tentar de novo</button></Notice></div>}
    {message && <p role="status" className="li-muted">{message}</p>}
    {!pending || !history ? <p role="status" className="li-muted">Carregando aprovações…</p>
    // Both tabs stay mounted so an edited comment survives a look at the history.
    : <><div hidden={tab !== "pending"}>{!pending.length ? <section className="li-panel li-campaign-empty"><Icon name="MessageSquare" size={24}/><h2>Nada esperando por você</h2><p>Quando um passo de comentário vencer, o texto aparece aqui antes de sair.</p></section>
      : <div className="li-campaign-list">{pending.map(a => <LinkedinApprovalCard key={a.id} approval={a} onDone={(m) => { setMessage(m); load(); }} onRefresh={load}/>)}</div>}</div>
    <div hidden={tab !== "history"}>{!history.length ? <section className="li-panel li-campaign-empty"><h2>Nenhuma decisão ainda</h2><p>Os comentários aprovados, rejeitados ou vencidos ficam aqui.</p></section>
      : <div className="li-campaign-list">{history.map(a => <section key={a.id} className="li-panel li-campaign-row"><div><h2>{a.person.name}</h2><Badge tone={approvalState[a.state]?.[1]}>{approvalState[a.state]?.[0] ?? a.state}</Badge></div><p className="li-muted">Campanha {a.campaign.name} · {when(a.decidedAt ?? a.createdAt)}</p><p className="li-template-body">{a.body}</p></section>)}</div>}</div></>}
  </>;
}
function LinkedinApprovalCard({approval: a, onDone, onRefresh}: {approval: LinkedinApprovalView; onDone: (message: string) => void; onRefresh: () => void}) {
  const api = useConnectorApi(), [body, setBody] = useState(a.body), [confirm, setConfirm] = useState<{requestId: string} | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function publish() { if (!confirm) return; setBusy(true); setError(""); try { const r = await api<{state: string}>(`/api/linkedin/approvals/${a.id}/approve`, {body, expectedRevision: a.revision, requestId: confirm.requestId}); setConfirm(null); onDone(r.state === "posted" ? `Comentário publicado no post de ${a.person.name}.` : "Sem confirmação do LinkedIn. O comentário não será publicado de novo; confira o post no LinkedIn."); } catch (e) { setError((e as Error).message); setConfirm(null); onRefresh(); } finally { setBusy(false); } }
  async function reject() { setBusy(true); setError(""); try { await api(`/api/linkedin/approvals/${a.id}/reject`, {expectedRevision: a.revision}); onDone("Comentário rejeitado. A cadência segue para o próximo passo."); } catch (e) { setError((e as Error).message); onRefresh(); } finally { setBusy(false); } }
  return <section className="li-panel li-approval">
    <div className="row wrap"><div><h2>{a.person.name}</h2><small className="li-muted">{[a.person.headline, a.person.company].filter(Boolean).join(" · ")} · Campanha {a.campaign.name}</small></div><small className="li-muted">Vence em {when(a.expiresAt)}</small></div>
    <blockquote className="li-approval-post"><p>{a.post.text}</p>{a.post.url && <a href={a.post.url} target="_blank" rel="noopener noreferrer">Ver o post no LinkedIn</a>}</blockquote>
    <Field label={`Comentário · ${body.length} / ${COMMENT_MAX}`}><textarea rows={3} maxLength={COMMENT_MAX} value={body} disabled={busy} onChange={e => setBody(e.target.value)}/></Field>
    {body !== a.aiBody && <small className="li-muted">Você editou o texto da IA. <button type="button" className="text-button" onClick={() => setBody(a.aiBody)}>Voltar ao original</button></small>}
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
    <div className="form-actions"><Button variant="ghost" disabled={busy} onClick={reject}>Rejeitar</Button><Button variant="primary" disabled={busy || !body.trim()} onClick={() => setConfirm({requestId: crypto.randomUUID()})}>Aprovar e publicar</Button></div>
    {confirm && <Modal title="Publicar este comentário?" onClose={() => !busy && setConfirm(null)}><div className="stack"><p>O comentário sai pelo seu LinkedIn no post de {a.person.name} e fica público:</p><blockquote>{body}</blockquote><div className="form-actions"><Button disabled={busy} onClick={() => setConfirm(null)}>Voltar</Button><Button variant="primary" disabled={busy} onClick={publish}>{busy ? "Publicando…" : "Publicar comentário"}</Button></div></div></Modal>}
  </section>;
}
function LinkedinWaiting({section}: {section:string}) {
  const copy=waitingCopy[section]??waitingCopy.people;
  return <div className="li-waiting-layout"><section className="li-panel li-waiting"><Icon name="Linkedin" size={32}/><h1>{copy.title}</h1><p>{copy.description}</p><div className="row"><LinkButton href={campaignPath} variant="primary">Montar uma campanha <Icon name="ArrowRight" size={15}/></LinkButton><LinkButton href="/linkedin/dashboard">Como funciona</LinkButton></div></section><LinkedinPrerequisites/></div>;
}
const stageText: Record<PipelineStage, string> = { queued: "Na fila", warming: "Aquecida", invited: "Convidada", accepted: "Aceitou", replied: "Respondeu" };
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", {dateStyle: "short", timeStyle: "short"});
function LinkedinPeople() {
  const api = useConnectorApi(), [stage, setStage] = useState(""), [search, setSearch] = useState(""), [data, setData] = useState<{people: LinkedinPersonView[]; total: number} | null>(null), [error, setError] = useState(""), [open, setOpen] = useState<LinkedinPersonView | null>(null), [optOut, setOptOut] = useState<LinkedinPersonView | null>(null), [busy, setBusy] = useState(false);
  const load = () => { setError(""); api<{people: LinkedinPersonView[]; total: number}>("/api/linkedin/people?" + new URLSearchParams({...(stage ? {stage} : {}), ...(search.trim() ? {search: search.trim()} : {})})).then(setData).catch(e => setError(e.message)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [api, stage]);
  if (data && !data.total && !stage && !search.trim()) return <LinkedinWaiting section="people" />;
  async function confirmOptOut() { if (!optOut) return; setBusy(true); try { await api(`/api/linkedin/people/${optOut.id}/opt-out`, {}); setOptOut(null); load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <><PageHeader title="Pessoas" description="Quem entrou nas suas campanhas do LinkedIn, no estágio de cada um."/>
    <div className="li-toolbar"><form className="li-people-search" onSubmit={e => { e.preventDefault(); load(); }}><input aria-label="Buscar pessoa" placeholder="Buscar por nome ou empresa…" value={search} maxLength={100} onChange={e => setSearch(e.target.value)}/></form><SelectField aria-label="Etapa" value={stage} onChange={e => setStage(e.target.value)}><option value="">Etapa: todas</option>{PIPELINE_COLUMNS.filter(([id]) => id !== "warming").map(([id, label]) => <option key={id} value={id}>{label}</option>)}</SelectField></div>
    {error && <div role="alert"><Notice tone="error">{error} <button type="button" className="text-button" onClick={load}>Tentar de novo</button></Notice></div>}
    {!data ? <p role="status" className="li-muted">Carregando pessoas…</p> : !data.people.length ? <section className="li-panel li-campaign-empty"><Icon name="Search" size={24}/><h2>Ninguém com esses filtros</h2><p>Tire um filtro ou mude a busca.</p></section>
    : <section className="li-panel li-people"><table><thead><tr><th>Pessoa</th><th>Campanha</th><th>Etapa</th><th>Última atividade</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{data.people.map(x => <tr key={x.id}>
        <td><strong>{x.name}</strong><small>{[x.headline, x.company].filter(Boolean).join(" · ")}</small></td><td>{x.campaign.name}</td>
        <td>{x.stage ? <Badge tone={x.stage === "replied" ? "green" : "neutral"}>{stageText[x.stage]}</Badge> : <Badge>{({expired: "Expirado", skipped: "Pulado", failed: "Recusado"} as Record<string, string>)[x.state] ?? x.state}</Badge>}{x.optedOut && <small>Não contatar</small>}{x.draft && !x.optedOut && <small>Rascunho da cadência pronto</small>}</td>
        <td>{when(x.lastActivityAt)}</td>
        <td className="li-people-actions">{x.draft && !x.optedOut ? <Button variant="primary" onClick={() => setOpen(x)}>Revisar rascunho</Button> : (x.threadId || (x.state === "accepted" && !x.optedOut)) && <Button onClick={() => setOpen(x)}>{x.threadId ? "Conversa" : "Mensagem"}</Button>}{!x.optedOut && <Button variant="ghost" onClick={() => setOptOut(x)}>Não contatar mais</Button>}</td></tr>)}</tbody></table>
      {data.total > data.people.length && <p className="li-muted">Mostrando {data.people.length} de {data.total}. Use a busca para achar alguém.</p>}</section>}
    {open && <LinkedinConversation person={open} onClose={() => { setOpen(null); load(); }}/>}
    {optOut && <Modal title="Não contatar mais?" onClose={() => setOptOut(null)}><div className="stack"><p>A partir de agora, {optOut.name} não recebe convite nem mensagem pelo Prometeus. O histórico da conversa continua aqui.</p><div className="form-actions"><Button onClick={() => setOptOut(null)}>Cancelar</Button><Button variant="danger" disabled={busy} onClick={confirmOptOut}>Não contatar mais</Button></div></div></Modal>}
  </>;
}
// A reply is reviewed, then sent by the same person within a minute; an edit after the review needs a new one.
function LinkedinConversation({person, onClose}: {person: LinkedinPersonView; onClose: () => void}) {
  const api = useConnectorApi(), [thread, setThread] = useState<{thread: {optedOut: boolean}; messages: LinkedinMessageView[]} | null>(person.threadId ? null : {thread: {optedOut: person.optedOut}, messages: []}), [error, setError] = useState(""), [text, setText] = useState(person.draft ?? ""), [review, setReview] = useState<{token: string; expiresAt: string; body: string; requestId: string} | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  // With a conversation the reply goes to it; without one, the reviewed message starts the chat with this 1st-degree relation.
  const target = person.threadId ? `/api/linkedin/conversations/${person.threadId}` : `/api/linkedin/people/${person.id}`;
  const load = async () => { if (person.threadId) await api<{thread: {optedOut: boolean}; messages: LinkedinMessageView[]}>(`/api/linkedin/conversations/${person.threadId}`).then(setThread).catch(e => setError(e.message)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [api, person.threadId]);
  async function prepare() { setBusy(true); setError(""); setMessage(""); try { const r = await api<{token: string; expiresAt: string; body: string}>(`${target}/prepare-reply`, {body: text}); setReview({...r, requestId: crypto.randomUUID()}); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function send() { if (!review) return; setBusy(true); setError(""); try { const r = await api<{state: string}>(`${target}/confirm-reply`, {body: review.body, token: review.token, requestId: review.requestId}); setMessage(r.state === "sent" ? "Mensagem enviada." : "Sem confirmação do LinkedIn. A mensagem não será reenviada; confira a conversa no LinkedIn."); setReview(null); setText(""); await load(); } catch (e) { setError((e as Error).message); setReview(null); } finally { setBusy(false); } }
  return <Modal title={`${person.threadId ? "Conversa com" : "Mensagem para"} ${person.name}`} onClose={onClose} wide><div className="stack">
    {!thread ? <p role="status" className="li-muted">{error || "Carregando a conversa…"}</p> : thread.messages.length ? <ol className="li-thread">{thread.messages.map(m => <li key={m.id} className={m.direction === "out" ? "li-out" : "li-in"}><p>{m.body}</p><small>{m.direction === "out" ? "Você" : person.name} · {when(m.sentAt)}</small></li>)}</ol> : <p className="li-muted">Ainda não há conversa. A primeira mensagem revisada começa a conversa com esta conexão.</p>}
    {person.draft && !person.optedOut && !message && <Notice>Rascunho da cadência: revise, ajuste se quiser e envie. A cadência só segue depois que você enviar.</Notice>}
    {thread?.thread.optedOut ? <Notice>Esta pessoa pediu para não ser contatada. Nenhuma mensagem pode ser enviada.</Notice> : thread && <>
      {!review ? <><Field label="Sua mensagem"><textarea rows={4} maxLength={8000} value={text} disabled={busy} onChange={e => { setText(e.target.value); setMessage(""); }}/></Field><div className="form-actions"><Button variant="primary" disabled={!text.trim() || busy} onClick={prepare}>{busy ? "Revisando…" : "Revisar mensagem"}</Button></div></>
      : <div className="li-reply-review"><strong>Você vai enviar pelo seu LinkedIn:</strong><blockquote>{review.body}</blockquote><small>Envie em até um minuto. Para mudar o texto, volte e revise de novo.</small><div className="form-actions"><Button disabled={busy} onClick={() => setReview(null)}>Voltar e editar</Button><Button variant="primary" disabled={busy} onClick={send}>{busy ? "Enviando…" : "Enviar agora"}</Button></div></div>}
    </>}
    {error && thread && <div role="alert"><Notice tone="error">{error}</Notice></div>}{message && <p role="status" className="li-muted">{message}</p>}
  </div></Modal>;
}
function LinkedinPipeline() {
  const api = useConnectorApi(), [data, setData] = useState<{columns: {id: PipelineStage; label: string; total: number; people: LinkedinPersonView[]}[]} | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const load = () => { setError(""); api<typeof data & object>("/api/linkedin/pipeline").then(setData).catch(e => setError(e.message)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [api]);
  if (data && data.columns.every(c => !c.total)) return <LinkedinWaiting section="pipeline" />;
  async function move(x: LinkedinPersonView, stage: "accepted" | "replied") { setBusy(x.id); setError(""); try { await api(`/api/linkedin/people/${x.id}/move`, {stage, expectedRevision: x.stageRevision, requestId: crypto.randomUUID()}); } catch (e) { setError((e as Error).message); } finally { setBusy(""); load(); } }
  return <><PageHeader title="Pipeline do LinkedIn" description="Cada pessoa na coluna do estágio dela. Só a resposta muda à mão, para quem respondeu fora do LinkedIn."/>
    {error && <div role="alert"><Notice tone="error">{error} <button type="button" className="text-button" onClick={load}>Tentar de novo</button></Notice></div>}
    {!data ? <p role="status" className="li-muted">Carregando o pipeline…</p> : <div className="li-pipeline">{data.columns.map(col => <section key={col.id} className="li-panel li-pipeline-column" aria-label={col.label}><h2>{col.label} <span>{col.total}</span></h2>
      {col.id === "warming" && <p className="li-muted">O aquecimento ainda não está disponível.</p>}
      {col.people.map(x => <article key={x.id} className="li-pipeline-card"><strong>{x.name}</strong><small>{[x.company, x.campaign.name].filter(Boolean).join(" · ")}</small>
        {col.id === "accepted" && <Button disabled={busy === x.id} onClick={() => move(x, "replied")}>Marcar como respondeu</Button>}{col.id === "replied" && x.manualReply && <Button variant="ghost" disabled={busy === x.id} onClick={() => move(x, "accepted")}>Voltar para Aceitou</Button>}</article>)}
      {col.total > col.people.length && <small className="li-muted">+{col.total - col.people.length} em Pessoas</small>}</section>)}</div>}
  </>;
}
function LinkedinEnrichment() {
  return <><PageHeader title="Enriquecimento" description="O que o sistema descobre sozinho, e o que você pode aprofundar antes de contactar."/>
    <div className="li-two-grid li-enrichment"><section className="li-panel"><h2>Automático, em toda campanha</h2><ul>{["Perfil e empresa lidos antes do convite, para personalizar a nota.","E-mail e telefone extraídos do perfil no aceite, quando a pessoa os expõe.","Último post guardado para orientar a conversa."].map(text=><li key={text}><Icon name="CheckCircle2" size={17}/>{text}</li>)}</ul><p className="li-footnote">Este fluxo estará disponível quando a integração LinkedIn for implementada.</p></section>
    <section className="li-panel"><h2>Opcional, você escolhe, por lista</h2><p>Os dados extraídos podem virar variáveis nos seus templates.</p><ul>{[["Globe","Site + resumo com IA","Consulta páginas públicas e resume a empresa."],["Search","Extração profunda","Aprofunda a consulta nas páginas disponíveis."],["Mail","Verificar e-mail","A verificação disponível hoje é de formato e domínio."],["MessageSquare","Checar WhatsApp","Validação de WhatsApp pendente de integração."]].map(([icon,title,body])=><li key={title}><Icon name={icon} size={17}/><div><strong>{title}</strong><p>{body}</p></div></li>)}</ul></section></div>
    <section className="li-panel li-list-empty"><h2>Suas listas do LinkedIn</h2><p>Nenhuma lista do LinkedIn ainda, ela nasce junto da primeira campanha.</p><LinkButton href="/leads/enrich">Investigar sócios e gestores das suas empresas</LinkButton></section>
  </>;
}
const sequenceState: Record<string, [string, string]> = { draft: ["Rascunho", "neutral"], active: ["Ativa", "green"], paused: ["Pausada", "amber"], archived: ["Arquivada", "neutral"] };
const modeCopy = { automatic: "Os passos saem sozinhos pela sua conta: até 30 mensagens por dia, em dias úteis das 9h às 18h.", assisted: "Cada passo vira um rascunho que você revisa e envia pela conversa da pessoa. Nada sai sozinho.", none: "O envio de mensagens ainda não está habilitado na plataforma: você pode preparar a cadência, mas não ativá-la." };
const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);
function LinkedinCadences() {
  const identity = useIdentity(), canManage = ["owner", "admin"].includes(identity?.workspaces.find(w => w.id === identity.activeWorkspaceId)?.role ?? "");
  const api = useConnectorApi(), [query,setQuery]=useState(""),[status,setStatus]=useState(""),[view,setView]=useState("Lista"),[order,setOrder]=useState("Mais recentes");
  const [data, setData] = useState<{sequences: LinkedinSequenceView[]; mode: "automatic" | "assisted" | null} | null>(null), [error, setError] = useState(""), [editing, setEditing] = useState<LinkedinSequenceView | "new" | null>(null), [archive, setArchive] = useState<LinkedinSequenceView | null>(null), [busy, setBusy] = useState("");
  const load = () => { setError(""); api<{sequences: LinkedinSequenceView[]; mode: "automatic" | "assisted" | null}>("/api/linkedin/sequences").then(setData).catch(e => setError(e.message)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [api]);
  async function act(q: LinkedinSequenceView, action: string) { setBusy(q.id); setError(""); try { await api(`/api/linkedin/sequences/${q.id}/${action}`, {expectedRevision: q.revision}); setArchive(null); } catch (e) { setError((e as Error).message); } finally { setBusy(""); load(); } }
  const statusMap: Record<string, string> = {Ativas: "active", Pausadas: "paused", Rascunhos: "draft"};
  const rate = (q: LinkedinSequenceView) => (q.counts.stopped_replied ?? 0) / Math.max(1, total(q.counts));
  const shown = (data?.sequences ?? []).filter(q => (!query.trim() || (q.name + " " + q.campaign.name).toLowerCase().includes(query.trim().toLowerCase())) && (!status || q.state === statusMap[status]))
    .sort((a, b) => order === "Mais antigas" ? a.updatedAt.localeCompare(b.updatedAt) : order === "Nome A–Z" ? a.name.localeCompare(b.name) : order === "Mais enviados" ? total(b.counts) - total(a.counts) : order === "Mais respostas" ? (b.counts.stopped_replied ?? 0) - (a.counts.stopped_replied ?? 0) : order === "Melhor taxa de resposta" ? rate(b) - rate(a) : order === "Mais ativas hoje" ? (b.counts.active ?? 0) - (a.counts.active ?? 0) : b.updatedAt.localeCompare(a.updatedAt));
  return <><PageHeader title="Cadências" description="Cadências para quem aceitou seu convite" actions={<Button variant="primary" icon="Plus" onClick={()=>setEditing("new")}>Nova cadência</Button>}/>
    <div className="li-info-strip"><span>Estas são as cadências que trabalham quem aceitou seu convite. Quem ainda não aceitou é assunto da <Link href="/linkedin/campaigns">campanha</Link>.</span><Link href="/cadences">Ver todas</Link></div>
    <div className="li-toolbar li-cadence-toolbar"><input aria-label="Buscar cadência LinkedIn" placeholder="Buscar cadência ou campanha…" value={query} onChange={e=>setQuery(e.target.value)}/><SelectField aria-label="Status" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Status: todas</option>{["Ativas","Pausadas","Rascunhos"].map(x=><option key={x}>{x}</option>)}</SelectField><SelectField aria-label="Ordenar" value={order} onChange={e=>setOrder(e.target.value)}>{["Mais recentes","Mais antigas","Nome A–Z","Mais enviados","Mais respostas","Melhor taxa de resposta","Mais ativas hoje"].map(x=><option key={x}>{x}</option>)}</SelectField><div className="li-view" role="group" aria-label="Visualização">{["Lista","Cards"].map(x=><Button key={x} aria-label={x} title={x} aria-pressed={view===x} onClick={()=>setView(x)} icon={x==="Lista"?"ListChecks":"LayoutDashboard"}/>)}</div></div>
    {data && <p className="li-muted">{modeCopy[data.mode ?? "none"]}</p>}
    {error && <div role="alert"><Notice tone="error">{error} <button type="button" className="text-button" onClick={load}>Tentar de novo</button></Notice></div>}
    {!data ? <p role="status" className="li-muted">Carregando cadências…</p> : !shown.length ? <section className="li-cadence-empty li-campaign-empty"><Icon name="Search" size={24}/>{data.sequences.length ? <><h2>Nenhuma cadência com esses filtros</h2><p>Tire um filtro ou mude a busca.</p><Button onClick={()=>{setQuery("");setStatus("");setOrder("Mais recentes");}}>Limpar filtros</Button></> : <><h2>Nenhuma cadência ainda</h2><p>Monte as mensagens que seguem depois que a pessoa aceita o convite.</p><Button onClick={()=>setEditing("new")}>Nova cadência</Button></>}</section>
    : <div className={view === "Cards" ? "li-sequence-cards" : "li-campaign-list"}>{shown.map(q => <section className="li-panel li-campaign-row" key={q.id}>
        <div><h2>{q.name}</h2><Badge tone={sequenceState[q.state][1]}>{sequenceState[q.state][0]}</Badge></div>
        <p className="li-muted">Campanha {q.campaign.name} · {q.steps.length} {q.steps.length === 1 ? "passo" : "passos"}</p>
        <p className="li-campaign-counts">{([["active","Em andamento"],["waiting","Aguardando você"],["done","Concluídos"],["stopped_replied","Responderam"],["stopped_opted_out","Pediram para sair"]] as const).filter(([k]) => q.counts[k]).map(([k, label]) => <span key={k}>{label} <strong>{q.counts[k]}</strong></span>)}{!total(q.counts) && <span>{q.state === "draft" ? "Ainda não ativada." : "Ninguém entrou ainda."}</span>}</p>
        <div className="row wrap">{q.state === "draft" && <Button onClick={() => setEditing(q)}>Editar</Button>}
          {canManage && q.state === "draft" && <Button variant="primary" disabled={busy === q.id || !data.mode} onClick={() => act(q, "activate")}>Ativar</Button>}
          {canManage && q.state === "active" && <Button disabled={busy === q.id} onClick={() => act(q, "pause")}>Pausar</Button>}
          {canManage && q.state === "paused" && <Button disabled={busy === q.id || !data.mode} onClick={() => act(q, "resume")}>Retomar</Button>}
          {canManage && <Button variant="ghost" disabled={busy === q.id} onClick={() => setArchive(q)}>Arquivar</Button>}</div>
      </section>)}</div>}
    {editing && <LinkedinSequenceEditor sequence={editing === "new" ? null : editing} mode={data?.mode ?? null} onClose={(saved) => { setEditing(null); if (saved) load(); }}/>}
    {archive && <Modal title="Arquivar a cadência?" onClose={() => setArchive(null)}><div className="stack"><p>Ninguém mais recebe os passos desta cadência. Mensagens já enviadas continuam nas conversas.</p><div className="form-actions"><Button onClick={() => setArchive(null)}>Cancelar</Button><Button variant="danger" disabled={busy === archive.id} onClick={() => act(archive, "archive")}>Arquivar</Button></div></div></Modal>}
  </>;
}
function useLinkedinTemplates(kind?: "invite" | "message") {
  const api = useConnectorApi(), [templates, setTemplates] = useState<LinkedinTemplateView[]>([]);
  useEffect(() => { api<{templates: LinkedinTemplateView[]}>("/api/linkedin/templates").then(r => setTemplates(kind ? r.templates.filter(t => t.kind === kind) : r.templates)).catch(() => setTemplates([])); }, [api, kind]);
  return templates;
}
function LinkedinSequenceEditor({sequence, mode, onClose}: {sequence: LinkedinSequenceView | null; mode: "automatic" | "assisted" | null; onClose: (saved: boolean) => void}) {
  const api = useConnectorApi(), templates = useLinkedinTemplates("message"), [campaigns, setCampaigns] = useState<LinkedinCampaignView[] | null>(null);
  const [name, setName] = useState(sequence?.name ?? ""), [campaignId, setCampaignId] = useState(sequence?.campaign.id ?? ""), [steps, setSteps] = useState<LinkedinSequenceStep[]>(sequence?.steps ?? [{delayDays: 0, body: ""}]), [id] = useState(() => sequence?.id ?? crypto.randomUUID()), [revision, setRevision] = useState(sequence?.revision ?? 0), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { api<{campaigns: LinkedinCampaignView[]}>("/api/linkedin/campaigns").then(r => setCampaigns(r.campaigns.filter(c => c.state !== "cancelled"))).catch(e => setError(e.message)); }, [api]);
  const setStep = (i: number, patch: Partial<{delayDays: number; body: string; guidance: string}>) => setSteps(x => x.map((st, j) => j === i ? {...st, ...patch} as LinkedinSequenceStep : st));
  const setKind = (i: number, kind: "message" | "comment") => setSteps(x => x.map((st, j) => j !== i || (st.kind ?? "message") === kind ? st : kind === "comment" ? {kind, delayDays: st.delayDays, guidance: ""} : {delayDays: st.delayDays, body: ""}));
  async function save() { setBusy(true); setError(""); try { const r = await api<{revision: number}>("/api/linkedin/sequences", {action: "save", input: {id, expectedRevision: revision, sequence: {name, campaignId, steps}}}); setRevision(r.revision); onClose(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <Modal title={sequence ? "Editar cadência" : "Nova cadência"} onClose={() => onClose(false)} wide><form className="stack" onSubmit={e => { e.preventDefault(); void save(); }}>
    <p className="li-muted">{modeCopy[mode ?? "none"]}</p>
    <div className="li-two-grid"><Field label="Nome da cadência"><input required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Boas-vindas a quem aceitou"/></Field>
      <Field label="Campanha" help="Quem aceitar o convite desta campanha entra na cadência."><SelectField required value={campaignId} onChange={e => setCampaignId(e.target.value)}><option value="">{campaigns ? "Escolha uma campanha" : "Carregando…"}</option>{campaigns?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField></Field></div>
    <ol className="li-sequence-steps">{steps.map((st, i) => <li key={i} className="li-panel"><div className="row wrap"><strong>Passo {i + 1}</strong><Field label={i === 0 ? "Dias depois do aceite" : "Dias depois do passo anterior"}><input type="number" min={0} max={60} required value={st.delayDays} onChange={e => setStep(i, {delayDays: Number(e.target.value)})}/></Field>
        <div className="li-view" role="group" aria-label={`Tipo do passo ${i + 1}`}>{([["message","Mensagem"],["comment","Comentar o post mais recente"]] as const).map(([k, label]) => <Button type="button" key={k} aria-pressed={(st.kind ?? "message") === k} onClick={() => setKind(i, k)}>{label}</Button>)}</div>
        {st.kind !== "comment" && templates.length > 0 && <Field label="Usar um template"><SelectField value="" onChange={e => { const t = templates.find(x => x.id === e.target.value); if (t) setStep(i, {body: t.body}); }}><option value="">Escolher…</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField></Field>}
        {steps.length > 1 && <Button type="button" variant="ghost" icon="Trash2" aria-label={`Remover o passo ${i + 1}`} onClick={() => setSteps(x => x.filter((_, j) => j !== i))}/>}</div>
      {st.kind === "comment" ? <><Notice>A IA escreve um comentário sobre o post mais recente da pessoa (até 30 dias). Ele espera em <Link href="/linkedin/approvals">Aprovações</Link> e só é publicado com a sua aprovação. Sem post recente, o passo é pulado.</Notice>
        <Field label={`Orientação para a IA (opcional) · ${(st.guidance ?? "").length} / 300`}><input maxLength={300} value={st.guidance ?? ""} onChange={e => setStep(i, {guidance: e.target.value})} placeholder="Ex.: tom curioso, sem vender"/></Field></>
      : <><div className="li-tokens"><span>Inserir:</span>{["{nome}","{empresa}","{cargo}","{setor}","{prova}"].map(token => <Button type="button" key={token} onClick={() => setStep(i, {body: (st.body + (st.body && !st.body.endsWith(" ") ? " " : "") + token).slice(0, 8000)})}>{token}</Button>)}</div>
      <Field label={`Mensagem · ${st.body.length} / 8000`}><textarea required rows={4} maxLength={8000} value={st.body} onChange={e => setStep(i, {body: e.target.value})}/></Field></>}</li>)}</ol>
    {steps.length < 10 && <Button type="button" icon="Plus" onClick={() => setSteps(x => [...x, {delayDays: 2, body: ""}])}>Adicionar passo</Button>}
    <small className="li-muted">Quem responder, pedir para sair ou tiver a conta desconectada sai da cadência. Se faltar no perfil um dado usado no texto, a pessoa sai em vez de receber um texto inventado.</small>
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
    <div className="form-actions"><Button type="button" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" type="submit" disabled={busy || !name.trim() || !campaignId}>{busy ? "Salvando…" : "Salvar rascunho"}</Button></div>
  </form></Modal>;
}
function LinkedinTemplates() {
  const api = useConnectorApi(), [query,setQuery]=useState(""),[channel,setChannel]=useState("LinkedIn"),[view,setView]=useState("Cards");
  const [items, setItems] = useState<LinkedinTemplateView[] | null>(null), [error, setError] = useState(""), [editing, setEditing] = useState<LinkedinTemplateView | "new" | null>(null), [archive, setArchive] = useState<LinkedinTemplateView | null>(null), [busy, setBusy] = useState(false);
  const load = () => { setError(""); api<{templates: LinkedinTemplateView[]}>("/api/linkedin/templates").then(r => setItems(r.templates)).catch(e => setError(e.message)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [api]);
  async function doArchive() { if (!archive) return; setBusy(true); try { await api("/api/linkedin/templates", {action: "archive", id: archive.id, input: {expectedRevision: archive.revision}}); setArchive(null); load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const otherChannel = channel === "Email" || channel === "WhatsApp";
  const shown = (items ?? []).filter(t => !query.trim() || (t.name + " " + t.body).toLowerCase().includes(query.trim().toLowerCase()));
  return <><PageHeader title="Templates do LinkedIn" description="Seus textos prontos de convite e mensagem do LinkedIn. Reutilize nos passos das campanhas." actions={<Button variant="primary" icon="Plus" onClick={()=>setEditing("new")}>Novo template</Button>}/>
    <div className="li-toolbar"><input aria-label="Buscar template" placeholder="Buscar templates…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="li-view">{["Todos","Email","WhatsApp","LinkedIn"].map(x=><Button key={x} aria-pressed={channel===x} onClick={()=>setChannel(x)}>{x}</Button>)}</div><div className="li-view" role="group" aria-label="Visualização">{["Lista","Cards"].map(x=><Button key={x} aria-pressed={view===x} onClick={()=>setView(x)} icon={x==="Lista"?"ListChecks":"LayoutDashboard"}>{x}</Button>)}</div></div>
    {error && <div role="alert"><Notice tone="error">{error} <button type="button" className="text-button" onClick={load}>Tentar de novo</button></Notice></div>}
    {otherChannel ? <section className="li-panel li-campaign-empty"><Icon name={channel === "Email" ? "Mail" : "MessageSquare"} size={28}/><h2>Templates de {channel === "Email" ? "e-mail" : "WhatsApp"} ficam em Templates</h2><p>Esta página guarda os textos do LinkedIn.</p><LinkButton href="/templates">Abrir Templates</LinkButton></section>
    : !items ? <p role="status" className="li-muted">Carregando templates…</p> : !shown.length ? <><section className="li-panel li-templates-empty li-campaign-empty"><div className="li-template-illustration" aria-hidden="true"><Icon name="FileText" size={38}/><Icon name="Mail" size={26}/><Icon name="MessageSquare" size={26}/></div><h2>{items.length ? "Nenhum template com essa busca" : "Crie seu primeiro template"}</h2><p>Um modelo de mensagem pronto para reaproveitar nas cadências, sem reescrever.</p><Button variant="primary" icon="Plus" onClick={()=>setEditing("new")}>Criar template</Button></section><div className="li-three-grid li-template-help">{[["Escreva uma vez","Textos de convite e mensagem com variáveis."],["Use em várias cadências","Cada passo pode reutilizar um template."],["Revise antes de enviar","Nada sai sem uma campanha ou cadência que você ativa."]].map(([title,body])=><div key={title}><strong>{title}</strong><p>{body}</p></div>)}</div></>
    : <div className={view === "Cards" ? "li-sequence-cards" : "li-campaign-list"}>{shown.map(t => <section key={t.id} className="li-panel li-campaign-row"><div><h2>{t.name}</h2><Badge>{t.kind === "invite" ? "Convite" : "Mensagem"}</Badge></div><p className="li-template-body">{t.body}</p><div className="row wrap"><Button onClick={() => setEditing(t)}>Editar</Button><Button variant="ghost" onClick={() => setArchive(t)}>Arquivar</Button></div></section>)}</div>}
    {editing && <LinkedinTemplateEditor template={editing === "new" ? null : editing} onClose={(saved) => { setEditing(null); if (saved) load(); }}/>}
    {archive && <Modal title="Arquivar o template?" onClose={() => setArchive(null)}><div className="stack"><p>O template sai da lista. Campanhas e cadências que já copiaram o texto continuam iguais.</p><div className="form-actions"><Button onClick={() => setArchive(null)}>Cancelar</Button><Button variant="danger" disabled={busy} onClick={doArchive}>Arquivar</Button></div></div></Modal>}
  </>;
}
function LinkedinTemplateEditor({template, onClose}: {template: LinkedinTemplateView | null; onClose: (saved: boolean) => void}) {
  const api = useConnectorApi(), [name, setName] = useState(template?.name ?? ""), [kind, setKind] = useState<"invite" | "message">(template?.kind ?? "message"), [body, setBody] = useState(template?.body ?? ""), [id] = useState(() => template?.id ?? crypto.randomUUID()), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const max = kind === "invite" ? 300 : 8000;
  async function save() { setBusy(true); setError(""); try { await api("/api/linkedin/templates", {action: "save", input: {id, expectedRevision: template?.revision ?? 0, template: {name, kind, body}}}); onClose(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <Modal title={template ? "Editar template" : "Novo template"} onClose={() => onClose(false)}><form className="stack" onSubmit={e => { e.preventDefault(); void save(); }}>
    <Field label="Nome"><input required maxLength={100} value={name} onChange={e => setName(e.target.value)}/></Field>
    <div className="li-view" role="group" aria-label="Tipo">{([["message","Mensagem"],["invite","Nota de convite"]] as const).map(([k, label]) => <Button type="button" key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</Button>)}</div>
    <div className="li-tokens"><span>Inserir:</span>{["{nome}","{empresa}","{cargo}","{setor}","{prova}"].map(token => <Button type="button" key={token} onClick={() => setBody(b => (b + (b && !b.endsWith(" ") ? " " : "") + token).slice(0, max))}>{token}</Button>)}</div>
    <Field label={`Texto · ${body.length} / ${max}`}><textarea required rows={6} maxLength={max} value={body} onChange={e => setBody(e.target.value)}/></Field>
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
    <div className="form-actions"><Button type="button" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" type="submit" disabled={busy || !name.trim() || !body.trim() || body.length > max}>{busy ? "Salvando…" : "Salvar template"}</Button></div>
  </form></Modal>;
}
function LinkedinUnavailable({title,onClose}: {title:string;onClose:()=>void}) {
  const a = useContext(Availability);
  return <Modal title={title} onClose={onClose}><Notice>{a?.reason || pendingReason} Nenhum registro será criado e nenhuma mensagem será enviada.</Notice><div className="form-actions"><Button onClick={onClose}>Fechar</Button></div></Modal>;
}

const list = (value: string) => value.split(",").map(x => x.trim()).filter(Boolean);
function LinkedinCampaignDraft({campaignId}: {campaignId: string | null}) {
  const identity = useIdentity(), canManage = ["owner", "admin"].includes(identity?.workspaces.find(w => w.id === identity.activeWorkspaceId)?.role ?? "");
  const api = useConnectorApi(), router = useRouter(), inviteTemplates = useLinkedinTemplates("invite");
  const [d, setD] = useState<LinkedinCampaignDraft>(defaultCampaignDraft), [saved, setSaved] = useState<{id: string; revision: number; state: string} | null>(null), [loading, setLoading] = useState(!!campaignId);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [exploreError, setExploreError] = useState(""), [message, setMessage] = useState(""), [audience, setAudience] = useState<{total: number | null; sample: AudienceSample[]} | null>(null);
  const [review, setReview] = useState<{blockers: string[]; warnings: string[]; estimate: {invitesPer22Days: number; dailyLimit: number; label: string}} | null>(null), [unavailable, setUnavailable] = useState(false);
  const set = (patch: Partial<LinkedinCampaignDraft>) => { setD(x => ({...x, ...patch})); setMessage(""); };
  const setSource = (patch: Partial<LinkedinCampaignDraft["source"]>) => { setD(x => ({...x, source: {...x.source, ...patch}})); setAudience(null); setMessage(""); };
  const locked = !!saved && saved.state !== "draft";
  useEffect(() => { if (!campaignId) return; api<{campaigns: LinkedinCampaignView[]}>("/api/linkedin/campaigns").then(r => { const c = r.campaigns.find(x => x.id === campaignId); if (c) { setD(c.draft); setSaved({id: c.id, revision: c.revision, state: c.state}); } else setError("Campanha não encontrada."); }).catch(e => setError(e.message)).finally(() => setLoading(false)); }, [api, campaignId]);
  async function run(key: string, fn: () => Promise<void>) { setBusy(key); setError(""); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(""); } }
  const [newId] = useState(() => crypto.randomUUID());
  async function save() { const id = saved?.id ?? newId; const r = await api<{id: string; revision: number}>("/api/linkedin/campaigns", {action: "save", input: {id, expectedRevision: saved?.revision ?? 0, draft: d}}); setSaved({id: r.id, revision: r.revision, state: "draft"}); return r; }
  const explore = async () => { setBusy("explore"); setExploreError(""); try { setAudience(await api("/api/linkedin/campaigns", {action: "explore", input: d.source})); } catch (e) { setExploreError((e as Error).message); } finally { setBusy(""); } };
  const append = (token: string) => set({note: (d.note + (d.note && !d.note.endsWith(" ") ? " " : "") + token).slice(0, 300)});
  const prepare = () => run("review", async () => { const r = await save(); setReview(await api("/api/linkedin/campaigns", {action: "prepare", input: {id: r.id, revision: r.revision}})); });
  const activate = () => run("activate", async () => { await api("/api/linkedin/campaigns", {action: "confirm", input: {id: saved!.id, revision: saved!.revision}}); router.push("/linkedin/campaigns"); });
  const summary = d.source.mode === "post" ? "Engajamento em post" : d.source.mode === "url" ? "Busca por link" : [d.source.roles.join(", "), d.source.locations.join(", "), d.source.industries.join(", "), d.source.keyword].filter(Boolean).join(" · ") || d.source.description || "Ainda não definido";
  if (loading) return <p role="status" className="li-muted">Carregando a campanha…</p>;
  return <><PageHeader title={saved ? d.name || "Campanha" : "Nova campanha"} back="/linkedin/campaigns"/>
    {locked && <Notice>Esta campanha já foi ativada e não muda mais. Crie outra para mudar a mira.</Notice>}
    <form className="li-campaign-form" onSubmit={e => { e.preventDefault(); void prepare(); }}><fieldset disabled={locked} className="li-campaign-fieldset">
      <div className="li-campaign-main">
      <section className="li-panel"><h2><span className="li-step">1</span>Como você vai chamar esta prospecção</h2><Field label="Nome da campanha"><input required value={d.name} maxLength={100} onChange={e => set({name: e.target.value})} placeholder="Ex.: Diretores comerciais · São Paulo"/></Field></section>
      <section className="li-panel"><h2><span className="li-step">2</span>Quem você quer alcançar</h2><p>Descreva o público e explore antes de ativar: convite enviado não volta atrás.</p>
        <div className="li-two-grid li-audience-choice">{([["filters", "SlidersHorizontal", "Por filtros", "Cargo, setor e localização. Encontra quem se parece com o cliente ideal."], ["post", "MessageSquare", "Por engajamento em post", "Quem curtiu ou comentou um post. O assunto vira a abertura da conversa."]] as const).map(([value, icon, title, body]) => <button key={value} type="button" aria-pressed={value === "post" ? d.source.mode === "post" : d.source.mode !== "post"} onClick={() => setSource({mode: value})}><Icon name={icon} size={20}/><strong>{title}</strong><small>{body}</small></button>)}</div>
        {d.source.mode === "post" ? <Field label="Link do post do LinkedIn"><input type="url" placeholder="https://www.linkedin.com/posts/…" value={d.source.postUrl} onChange={e => setSource({postUrl: e.target.value})}/></Field> : <>
          <Field label="Descreva quem você quer alcançar"><textarea rows={3} maxLength={500} value={d.source.description} onChange={e => setSource({description: e.target.value})} placeholder="Ex.: sócios de empresas de tecnologia em São Paulo"/></Field><Button type="button" disabled={!d.source.description.trim()} icon="Sparkles" onClick={() => setUnavailable(true)}>Montar filtros com IA</Button><small className="li-muted">A sugestão cai nos campos abaixo para você revisar. Nada é aplicado sozinho.</small>
          <div className="li-view li-filter-mode"><Button type="button" aria-pressed={d.source.mode === "filters"} onClick={() => setSource({mode: "filters"})}>Montar filtros</Button><Button type="button" aria-pressed={d.source.mode === "url"} onClick={() => setSource({mode: "url"})}>Colar link do LinkedIn</Button></div>
          {d.source.mode === "url" ? <Field label="Link da busca do LinkedIn"><input type="url" value={d.source.searchUrl} onChange={e => setSource({searchUrl: e.target.value})} placeholder="https://www.linkedin.com/search/results/people/…"/></Field> : <>
            <LinkedinSuggestionField label="Cargos" value={d.source.roles.join(", ")} onChange={v => setSource({roles: list(v).slice(0, 5)})} options={["CEO","Sócio","Fundador","Proprietário","Diretor","Diretor Comercial","Head de Vendas","Gerente Comercial","Diretor de Marketing","Gerente de Marketing","Head de Marketing","Diretor de TI"]} help="Até 5 cargos. Somar cargos amplia o público: a busca aceita qualquer um deles."/>
            <LinkedinSuggestionField label="Localização" value={d.source.locations.join(", ")} onChange={v => setSource({locations: list(v).slice(0, 10)})} options={["Brasil","São Paulo","Rio de Janeiro","Minas Gerais","Paraná","Santa Catarina","Rio Grande do Sul","São Paulo e Região","Argentina","México","Portugal","Estados Unidos"]} help="País, estado ou cidade. Somar lugares amplia o público."/>
            <LinkedinSuggestionField label="Setor" value={d.source.industries.join(", ")} onChange={v => setSource({industries: list(v).slice(0, 10)})} options={["Software","Marketing e publicidade","Serviços financeiros","Educação","Varejo","Logística e cadeia de suprimentos","Indústria","Serviços e consultoria de TI","Hospitais e atendimento médico","Construção"]} help="Opcional. A pessoa precisa atender a todos os campos preenchidos."/>
            <Field label="Palavra-chave no perfil (opcional)" help="A palavra precisa aparecer no perfil. Na dúvida, deixe vazio e explore antes."><input maxLength={100} value={d.source.keyword} onChange={e => setSource({keyword: e.target.value})}/></Field>
            <details className="li-combination"><summary>Como estes campos se combinam</summary><p>Dentro do mesmo campo, soma. Entre campos, cruza: cargo e localização e setor. Cada campo novo fecha o público.</p></details>
            <fieldset className="li-checkboxes"><legend>Distância na rede</legend>{([[2, "2º grau, amigo de amigo"], [3, "3º grau, fora da sua rede"]] as const).map(([deg, label]) => <label key={deg}><input type="checkbox" checked={d.source.degrees.includes(deg)} onChange={e => setSource({degrees: e.target.checked ? [...d.source.degrees, deg].sort() as (2 | 3)[] : d.source.degrees.filter(x => x !== deg)})}/>{label}</label>)}<small>Quem já é sua conexão (1º grau) fica sempre de fora.</small></fieldset>
          </>}
        </>}
        <div className="row wrap"><Button type="button" icon="Search" disabled={busy === "explore" || !d.source.degrees.length} onClick={explore}>{busy === "explore" ? "Explorando…" : "Explorar público"}</Button><small>Explorar não gasta convite.</small></div>
        {exploreError && <div role="alert"><Notice tone="error">{exploreError}</Notice></div>}
        {audience && <div className="li-audience-result" role="status"><strong>{audience.total === null ? `${audience.sample.length} pessoas na amostra` : `${audience.total.toLocaleString("pt-BR")} pessoas encontradas agora`}</strong>{audience.sample.length ? <ul>{audience.sample.map((x, i) => <li key={i}><span>{x.name}</span><small>{[x.headline, x.location, x.degree ? `${x.degree}º grau` : ""].filter(Boolean).join(" · ")}</small></li>)}</ul> : <small>A busca não devolveu ninguém. Afrouxe um filtro.</small>}</div>}
        <label className="li-check"><input type="checkbox" checked={d.decisionMakerOnly} onChange={e => set({decisionMakerOnly: e.target.checked})}/><span><strong>Descartar antes do convite quem não for decisor</strong><small>A triagem por IA ainda não está disponível: desmarque para ativar a campanha.</small></span></label>
      </section>
      <section className="li-panel"><h2><span className="li-step">3</span>O que a pessoa vai ler no convite</h2><p>Deixe em branco para enviar convite sem nota.</p><Field label="Suas provas (o que a ficha {prova} escreve)"><input maxLength={200} value={d.proof} onChange={e => set({proof: e.target.value})} placeholder="Uma frase curta e verificável sobre sua empresa"/></Field><Button type="button" onClick={() => set({extraProof: d.extraProof ? "" : " "})}>Outra prova (para usar em outro ângulo)</Button>{d.extraProof !== "" && <Field label="Outra prova"><input maxLength={200} value={d.extraProof.trimStart()} onChange={e => set({extraProof: e.target.value || " "})}/></Field>}<small className="li-muted">Frases verificáveis. Vão literais, sem a IA reescrever. A ficha {"{prova}"} usa a primeira; a outra fica guardada para outro ângulo.</small><div className="li-tokens"><span>Inserir:</span>{["{nome}","{empresa}","{cargo}","{setor}","{prova}"].map(token => <Button type="button" key={token} onClick={() => append(token)}>{token}</Button>)}<Button type="button" icon="Sparkles" onClick={() => setUnavailable(true)}>trecho da IA</Button></div>{inviteTemplates.length > 0 && <Field label="Usar um template de convite"><SelectField value="" onChange={e => { const t = inviteTemplates.find(x => x.id === e.target.value); if (t) set({note: t.body}); }}><option value="">Escolher…</option>{inviteTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField></Field>}<Field label={`Texto do convite · ${d.note.length} / 300`}><textarea rows={4} maxLength={300} value={d.note} onChange={e => set({note: e.target.value})}/></Field><Button type="button" onClick={() => set({note: "Olá, {nome}! Vi seu trabalho na {empresa} e achei que valia nos conectarmos. Posso acompanhar suas novidades por aqui?"})}>Usar a nota sugerida (sem pedido, só o motivo pra conectar)</Button><small className="li-muted">Quem não tiver no perfil um dado usado na nota fica de fora, em vez de receber um texto inventado.</small></section>
      </div><aside className="li-campaign-aside"><section className="li-panel"><h2><span className="li-step">4</span>Em que ritmo os convites saem</h2><div className="li-two-grid"><Field label="Convites por dia" help={`Até ${LINKEDIN_DAILY_CAP} por dia na conta, somando campanhas. É um teto, não uma promessa de envio.`}><input type="number" min={1} max={LINKEDIN_DAILY_CAP} required value={d.dailyLimit} onChange={e => set({dailyLimit: Number(e.target.value)})}/></Field><Field label="Expirar convite depois de (dias)" help="Retirar um convite não devolve a cota da semana."><input type="number" min={1} max={365} required value={d.expireDays} onChange={e => set({expireDays: Number(e.target.value)})}/></Field></div><label className="li-check"><input type="checkbox" checked={d.warming} onChange={e => set({warming: e.target.checked})}/><span><strong>Permitir aquecimento social</strong><small>Visitar o perfil e curtir um post antes do convite. Ainda não disponível: desmarque para ativar a campanha.</small></span></label></section>
      <section className="li-panel"><h2><span className="li-step">5</span>Para onde vão os que aceitarem</h2><Field label="Lista dos aceites"><SelectField defaultValue="new"><option value="new">Criar uma lista nova automaticamente (recomendado)</option></SelectField></Field><p className="li-muted">É esta lista que alimenta a cadência. Ela nasce quando você ativa a campanha.</p><label className="li-check"><input type="checkbox" role="switch" checked={d.enrichOnAccept} onChange={e => set({enrichOnAccept: e.target.checked})}/><span><strong>Enriquecer sozinho quem aceitar</strong><small>No aceite, guarda o e-mail e o telefone que a pessoa expõe no perfil. Nada é deduzido.</small></span></label><Field label="Lista dos não aceites (opcional)"><SelectField value={d.otherList} onChange={e => set({otherList: e.target.value as "none" | "new"})}><option value="none">Não usar</option><option value="new">Criar uma lista nova ao ativar a campanha</option></SelectField></Field><p className="li-muted">Convites expirados podem alimentar uma cadência de e-mail. Os convites do LinkedIn saem espaçados no horário comercial.</p></section>
      </aside></fieldset><div className="li-draft-notice"><Icon name="Info" size={17}/><span>{saved ? `Rascunho salvo no workspace (revisão ${saved.revision}).` : "O rascunho é salvo no workspace quando você salva ou revisa."} Nenhum convite sai antes de você ativar.</span></div>
      {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}{message && <p role="status" className="li-muted">{message}</p>}
      <div className="form-actions"><LinkButton href="/linkedin/campaigns">Cancelar</LinkButton>{!locked && <Button type="button" disabled={!d.name.trim() || !!busy} onClick={() => run("save", async () => { await save(); setMessage("Rascunho salvo."); })}>{busy === "save" ? "Salvando…" : "Salvar rascunho"}</Button>}{!locked && <Button variant="primary" type="submit" disabled={!d.name.trim() || !!busy}>{busy === "review" ? "Revisando…" : "Revisar e ativar"}</Button>}</div>
    </form>
    {review && saved && <Modal title="Revisar a campanha" onClose={() => setReview(null)}><div className="stack"><h3>{d.name}</h3><dl className="li-review"><dt>Público</dt><dd>{summary}</dd><dt>Convite</dt><dd>{d.note || "Sem nota"}</dd><dt>Ritmo</dt><dd>{d.dailyLimit} por dia · expirar em {d.expireDays} dias</dd><dt>Destino</dt><dd>Lista nova de aceites{d.otherList === "new" ? " e lista nova de não aceites" : ""}</dd></dl>
      <div className="li-review-split"><div><strong>Público real</strong><p>{audience ? audience.total === null ? `${audience.sample.length} pessoas na amostra da busca` : `${audience.total.toLocaleString("pt-BR")} pessoas na busca de agora` : "Explore o público para ver o número real antes de ativar."}</p></div><div><strong>Estimativa</strong><p>Até {review.estimate.invitesPer22Days} convites em 22 dias úteis. {review.estimate.label}.</p></div></div>
      {review.blockers.length > 0 && <Notice tone="error"><strong>Antes de ativar:</strong><ul>{review.blockers.map(b => <li key={b}>{b}</li>)}</ul></Notice>}
      {review.warnings.map(w => <p className="li-muted" key={w}>{w}</p>)}
      {!canManage && <p className="li-muted">Somente proprietário ou administrador ativa a campanha. O rascunho fica salvo.</p>}
      {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
      <div className="form-actions"><Button onClick={() => setReview(null)}>Continuar editando</Button>{canManage && <Button variant="primary" disabled={review.blockers.length > 0 || !!busy} onClick={activate}>{busy === "activate" ? "Ativando…" : "Ativar campanha"}</Button>}</div></div></Modal>}
    {unavailable && <Modal title="Ajuda da IA" onClose={() => setUnavailable(false)}><Notice>A ajuda da IA para filtros e trechos da nota ainda não está disponível. Preencha os campos à mão; nada é enviado sem a sua revisão.</Notice><div className="form-actions"><Button onClick={() => setUnavailable(false)}>Fechar</Button></div></Modal>}
  </>;
}
function LinkedinSuggestionField({label,value,onChange,options,help}: {label:string;value:string;onChange:(value:string)=>void;options:string[];help:string}) {
  return <div className="li-suggestion-field"><Field label={label}><input value={value} onChange={e=>onChange(e.target.value)}/></Field><div className="li-suggestions">{options.map(option=><button type="button" key={option} aria-pressed={value.split(", ").includes(option)} onClick={()=>{const selected=value?value.split(", "):[];onChange(selected.includes(option)?selected.filter(x=>x!==option).join(", "):[...selected,option].join(", "));}}>{option}</button>)}</div><small className="li-muted">{help}</small></div>;
}
