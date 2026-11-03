"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "@/client/workspace-provider";
import { useConnectorApi } from "./apollo-connection";
import { LINKEDIN_TERMS, type LinkedinAccountView } from "@/domain/linkedin-connection";
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
    {section === "dashboard" ? <LinkedinOverview /> : section === "campaigns/new" ? <LinkedinCampaignDraft campaignId={campaignId} /> : section === "campaigns" ? <LinkedinCampaigns /> : section === "enrichment" ? <LinkedinEnrichment /> : section === "cadences" ? <LinkedinCadences /> : section === "templates" ? <LinkedinTemplates /> : <LinkedinWaiting section={section} />}
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
function LinkedinWaiting({section}: {section:string}) {
  const copy=waitingCopy[section]??waitingCopy.people;
  return <div className="li-waiting-layout"><section className="li-panel li-waiting"><Icon name="Linkedin" size={32}/><h1>{copy.title}</h1><p>{copy.description}</p><div className="row"><LinkButton href={campaignPath} variant="primary">Montar uma campanha <Icon name="ArrowRight" size={15}/></LinkButton><LinkButton href="/linkedin/dashboard">Como funciona</LinkButton></div></section><LinkedinPrerequisites/></div>;
}
function LinkedinEnrichment() {
  return <><PageHeader title="Enriquecimento" description="O que o sistema descobre sozinho, e o que você pode aprofundar antes de contactar."/>
    <div className="li-two-grid li-enrichment"><section className="li-panel"><h2>Automático, em toda campanha</h2><ul>{["Perfil e empresa lidos antes do convite, para personalizar a nota.","E-mail e telefone extraídos do perfil no aceite, quando a pessoa os expõe.","Último post guardado para orientar a conversa."].map(text=><li key={text}><Icon name="CheckCircle2" size={17}/>{text}</li>)}</ul><p className="li-footnote">Este fluxo estará disponível quando a integração LinkedIn for implementada.</p></section>
    <section className="li-panel"><h2>Opcional, você escolhe, por lista</h2><p>Os dados extraídos podem virar variáveis nos seus templates.</p><ul>{[["Globe","Site + resumo com IA","Consulta páginas públicas e resume a empresa."],["Search","Extração profunda","Aprofunda a consulta nas páginas disponíveis."],["Mail","Verificar e-mail","A verificação disponível hoje é de formato e domínio."],["MessageSquare","Checar WhatsApp","Validação de WhatsApp pendente de integração."]].map(([icon,title,body])=><li key={title}><Icon name={icon} size={17}/><div><strong>{title}</strong><p>{body}</p></div></li>)}</ul></section></div>
    <section className="li-panel li-list-empty"><h2>Suas listas do LinkedIn</h2><p>Nenhuma lista do LinkedIn ainda, ela nasce junto da primeira campanha.</p><LinkButton href="/leads/enrich">Investigar sócios e gestores das suas empresas</LinkButton></section>
  </>;
}
function LinkedinCadences() {
  const [query,setQuery]=useState(""),[status,setStatus]=useState(""),[view,setView]=useState("Lista"),[period,setPeriod]=useState("30 dias"),[order,setOrder]=useState("Mais recentes"),[unavailable,setUnavailable]=useState(false);
  return <><PageHeader title="Cadências" description="Cadências para quem aceitou seu convite" actions={<Button variant="primary" icon="Plus" onClick={()=>setUnavailable(true)}>Nova cadência</Button>}/>
    <div className="li-info-strip"><span>Estas são as cadências que trabalham quem aceitou seu convite. Quem ainda não aceitou é assunto da <Link href="/linkedin/campaigns">campanha</Link>.</span><Link href="/cadences">Ver todas</Link></div>
    <div className="li-toolbar li-cadence-toolbar"><input aria-label="Buscar cadência LinkedIn" placeholder="Buscar cadência, lista ou tag…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Status" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Status: todas</option>{["Ativas","Pausadas","Inativas","Concluídas","Rascunhos"].map(x=><option key={x}>{x}</option>)}</select><select aria-label="Período das métricas" value={period} onChange={e=>setPeriod(e.target.value)}>{["hoje","7 dias","30 dias","90 dias","tudo"].map(x=><option key={x} value={x}>Métricas: {x}</option>)}</select><select aria-label="Ordenar" value={order} onChange={e=>setOrder(e.target.value)}>{["Mais recentes","Mais antigas","Nome A–Z","Mais enviados","Mais respostas","Melhor taxa de resposta","Mais ativas hoje"].map(x=><option key={x}>{x}</option>)}</select><div className="li-view" role="group" aria-label="Visualização">{["Lista","Cards"].map(x=><Button key={x} aria-label={x} title={x} aria-pressed={view===x} onClick={()=>setView(x)} icon={x==="Lista"?"ListChecks":"LayoutDashboard"}/>)}</div></div>
    <section className="li-cadence-empty li-campaign-empty"><Icon name="Search" size={24}/><h2>Nenhuma cadência com esses filtros</h2><p>Tire um filtro ou mude a busca.</p><Button onClick={()=>{setQuery("");setStatus("");setPeriod("30 dias");setOrder("Mais recentes");}}>Limpar filtros</Button><p className="li-footnote">Cadências de LinkedIn aguardam a integração. Suas cadências atuais continuam em Disparos em Massa.</p></section>
    {unavailable&&<LinkedinUnavailable title="Cadência de LinkedIn" onClose={()=>setUnavailable(false)}/>}
  </>;
}
function LinkedinTemplates() {
  const [query,setQuery]=useState(""),[channel,setChannel]=useState("LinkedIn"),[view,setView]=useState("Cards"),[unavailable,setUnavailable]=useState(false);
  return <><PageHeader title="Templates do LinkedIn" description="Seus textos prontos de convite e mensagem do LinkedIn. Reutilize nos passos das campanhas." actions={<Button variant="primary" icon="Plus" onClick={()=>setUnavailable(true)}>Novo template</Button>}/>
    <div className="li-toolbar"><input aria-label="Buscar template" placeholder="Buscar templates…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="li-view">{["Todos","Email","WhatsApp","LinkedIn"].map(x=><Button key={x} aria-pressed={channel===x} onClick={()=>setChannel(x)}>{x}</Button>)}</div><div className="li-view" role="group" aria-label="Visualização">{["Lista","Cards"].map(x=><Button key={x} aria-pressed={view===x} onClick={()=>setView(x)} icon={x==="Lista"?"ListChecks":"LayoutDashboard"}>{x}</Button>)}</div></div>
    <section className="li-panel li-templates-empty li-campaign-empty"><div className="li-template-illustration" aria-hidden="true"><Icon name="FileText" size={38}/><Icon name="Mail" size={26}/><Icon name="MessageSquare" size={26}/></div><h2>Crie seu primeiro template</h2><p>Um modelo de mensagem pronto para reaproveitar nas cadências, sem reescrever.</p><Button variant="primary" icon="Plus" onClick={()=>setUnavailable(true)}>Criar template</Button></section><div className="li-three-grid li-template-help">{[["Escreva uma vez","Textos de convite e mensagem com variáveis."],["Use em várias cadências","Cada passo pode reutilizar um template."],["Revise antes de enviar","A integração LinkedIn ainda está pendente."]].map(([title,body])=><div key={title}><strong>{title}</strong><p>{body}</p></div>)}</div>
    {unavailable&&<LinkedinUnavailable title="Template de LinkedIn" onClose={()=>setUnavailable(false)}/>}
  </>;
}
function LinkedinUnavailable({title,onClose}: {title:string;onClose:()=>void}) {
  const a = useContext(Availability);
  return <Modal title={title} onClose={onClose}><Notice>{a?.reason || pendingReason} Nenhum registro será criado e nenhuma mensagem será enviada.</Notice><div className="form-actions"><Button onClick={onClose}>Fechar</Button></div></Modal>;
}

const list = (value: string) => value.split(",").map(x => x.trim()).filter(Boolean);
function LinkedinCampaignDraft({campaignId}: {campaignId: string | null}) {
  const identity = useIdentity(), canManage = ["owner", "admin"].includes(identity?.workspaces.find(w => w.id === identity.activeWorkspaceId)?.role ?? "");
  const api = useConnectorApi(), router = useRouter();
  const [d, setD] = useState<LinkedinCampaignDraft>(defaultCampaignDraft), [saved, setSaved] = useState<{id: string; revision: number; state: string} | null>(null), [loading, setLoading] = useState(!!campaignId);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [exploreError, setExploreError] = useState(""), [message, setMessage] = useState(""), [audience, setAudience] = useState<{total: number | null; sample: AudienceSample[]} | null>(null);
  const [review, setReview] = useState<{blockers: string[]; warnings: string[]; estimate: {invitesPer22Days: number; dailyLimit: number; label: string}} | null>(null), [unavailable, setUnavailable] = useState(false);
  const set = (patch: Partial<LinkedinCampaignDraft>) => { setD(x => ({...x, ...patch})); setMessage(""); };
  const setSource = (patch: Partial<LinkedinCampaignDraft["source"]>) => { setD(x => ({...x, source: {...x.source, ...patch}})); setAudience(null); setMessage(""); };
  const locked = !!saved && saved.state !== "draft";
  useEffect(() => { if (!campaignId) return; api<{campaigns: LinkedinCampaignView[]}>("/api/linkedin/campaigns").then(r => { const c = r.campaigns.find(x => x.id === campaignId); if (c) { setD(c.draft); setSaved({id: c.id, revision: c.revision, state: c.state}); } else setError("Campanha não encontrada."); }).catch(e => setError(e.message)).finally(() => setLoading(false)); }, [api, campaignId]);
  async function run(key: string, fn: () => Promise<void>) { setBusy(key); setError(""); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(""); } }
  async function save() { const id = saved?.id ?? crypto.randomUUID(); const r = await api<{id: string; revision: number}>("/api/linkedin/campaigns", {action: "save", input: {id, expectedRevision: saved?.revision ?? 0, draft: d}}); setSaved({id: r.id, revision: r.revision, state: "draft"}); return r; }
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
            <LinkedinSuggestionField label="Cargos" value={d.source.roles.join(", ")} onChange={v => setSource({roles: list(v).slice(0, 5)})} options={["CEO","Sócio","Fundador","Proprietário","Diretor","Diretor Comercial","Head de Vendas","Gerente Comercial","Diretor de Marketing","Gerente de Marketing","Head de Marketing","Diretor de TI"]} help="Até 5 cargos. Somar cargos amplia o público; cada cargo vira uma busca própria."/>
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
      <section className="li-panel"><h2><span className="li-step">3</span>O que a pessoa vai ler no convite</h2><p>Deixe em branco para enviar convite sem nota.</p><Field label="Suas provas (o que a ficha {prova} escreve)"><input maxLength={200} value={d.proof} onChange={e => set({proof: e.target.value})} placeholder="Uma frase curta e verificável sobre sua empresa"/></Field><Button type="button" onClick={() => set({extraProof: d.extraProof ? "" : " "})}>Outra prova (para usar em outro ângulo)</Button>{d.extraProof !== "" && <Field label="Outra prova"><input maxLength={200} value={d.extraProof.trimStart()} onChange={e => set({extraProof: e.target.value || " "})}/></Field>}<small className="li-muted">Frases verificáveis. Vão literais, sem a IA reescrever.</small><div className="li-tokens"><span>Inserir:</span>{["{nome}","{empresa}","{cargo}","{setor}","{prova}"].map(token => <Button type="button" key={token} onClick={() => append(token)}>{token}</Button>)}<Button type="button" icon="Sparkles" onClick={() => setUnavailable(true)}>trecho da IA</Button></div><Field label={`Texto do convite · ${d.note.length} / 300`}><textarea rows={4} maxLength={300} value={d.note} onChange={e => set({note: e.target.value})}/></Field><Button type="button" onClick={() => set({note: "Olá, {nome}! Vi seu trabalho na {empresa} e achei que valia nos conectarmos. Posso acompanhar suas novidades por aqui?"})}>Usar a nota sugerida (sem pedido, só o motivo pra conectar)</Button><small className="li-muted">Quem não tiver no perfil um dado usado na nota fica de fora, em vez de receber um texto inventado.</small></section>
      </div><aside className="li-campaign-aside"><section className="li-panel"><h2><span className="li-step">4</span>Em que ritmo os convites saem</h2><div className="li-two-grid"><Field label="Convites por dia" help={`Até ${LINKEDIN_DAILY_CAP} por dia na conta, somando campanhas. É um teto, não uma promessa de envio.`}><input type="number" min={1} max={LINKEDIN_DAILY_CAP} required value={d.dailyLimit} onChange={e => set({dailyLimit: Number(e.target.value)})}/></Field><Field label="Expirar convite depois de (dias)" help="Retirar um convite não devolve a cota da semana."><input type="number" min={1} max={365} required value={d.expireDays} onChange={e => set({expireDays: Number(e.target.value)})}/></Field></div><label className="li-check"><input type="checkbox" checked={d.warming} onChange={e => set({warming: e.target.checked})}/><span><strong>Permitir aquecimento social</strong><small>Visitar o perfil e curtir um post antes do convite. Só ativa se a plataforma liberar visita e curtida.</small></span></label></section>
      <section className="li-panel"><h2><span className="li-step">5</span>Para onde vão os que aceitarem</h2><Field label="Lista dos aceites"><select defaultValue="new"><option value="new">Criar uma lista nova automaticamente (recomendado)</option></select></Field><p className="li-muted">É esta lista que alimenta a cadência. Ela nasce quando você ativa a campanha.</p><label className="li-check"><input type="checkbox" role="switch" checked={d.enrichOnAccept} onChange={e => set({enrichOnAccept: e.target.checked})}/><span><strong>Enriquecer sozinho quem aceitar</strong><small>No aceite, guarda o e-mail e o telefone que a pessoa expõe no perfil. Nada é deduzido.</small></span></label><Field label="Lista dos não aceites (opcional)"><select value={d.otherList} onChange={e => set({otherList: e.target.value as "none" | "new"})}><option value="none">Não usar</option><option value="new">Criar uma lista nova ao ativar a campanha</option></select></Field><p className="li-muted">Convites expirados podem alimentar uma cadência de e-mail. Os convites do LinkedIn saem espaçados no horário comercial.</p></section>
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
