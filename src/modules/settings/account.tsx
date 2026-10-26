"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { useIdentity, useCapabilities } from "@/client/workspace-provider";
import { createBillingClient, type BillingClient } from "@/client/billing-client";
import type { BillingView } from "@/domain/billing";
import { authClient } from "@/lib/auth-client";
import { identityPost } from "@/modules/auth/workspace";
import { Button, Field, Toggle, Notice } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { BillingContactForm } from "./billing-dialog";
import { UserRound, ContactRound } from "lucide-react";

const timezones = [
  ["America/Sao_Paulo", "Brasília (UTC−3)"], ["America/Manaus", "Manaus (UTC−4)"],
  ["America/Belem", "Belém (UTC−3)"], ["America/Fortaleza", "Fortaleza (UTC−3)"],
  ["America/Recife", "Recife (UTC−3)"], ["America/Cuiaba", "Cuiabá (UTC−4)"],
  ["America/Rio_Branco", "Rio Branco (UTC−5)"], ["America/Noronha", "Fernando de Noronha (UTC−2)"],
  ["America/New_York", "New York"], ["America/Chicago", "Chicago"], ["America/Los_Angeles", "Los Angeles"],
  ["America/Argentina/Buenos_Aires", "Buenos Aires"], ["America/Santiago", "Santiago"],
  ["America/Bogota", "Bogotá"], ["America/Mexico_City", "Cidade do México"],
  ["Europe/Lisbon", "Lisboa"], ["Europe/London", "Londres"], ["Europe/Paris", "Paris"],
  ["Europe/Berlin", "Berlim"], ["Asia/Tokyo", "Tóquio"], ["Australia/Sydney", "Sydney"],
];
function AccountBilling({workspaceId,email}:{workspaceId:string;email:string}) {
  const [client,setClient]=useState<BillingClient|null>(null),[view,setView]=useState<BillingView|null>(null),[error,setError]=useState("");
  useEffect(()=>{let active=true;const api=createBillingClient({workspaceId});setClient(api);api.read().then(value=>{if(active)setView(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;api.dispose();};},[workspaceId]);
  async function refresh(){if(client){setView(await client.read());window.dispatchEvent(new Event('billing-updated'));}}
  return <div className="settings-contact-block"><h3>Cobrança</h3><p>Faturas, recibos e boletos do plano. Vale também no Stripe.</p>{error&&<p role="alert">{error}</p>}{!view&&!error&&<p role="status">Consultando contato de cobrança…</p>}{view&&client&&(view.canManage?<BillingContactForm key={view.revision} view={view} client={client} accountEmail={email} onChanged={refresh}/>:<p>Somente proprietários e administradores podem alterar o contato de cobrança.</p>)}</div>;
}
export function Account() {
  const s=useDemo(),repo=useRepository(),run=useAction(),identity=useIdentity(),capabilities=useCapabilities();
  const [p,setP]=useState({...s.preferences}),[name,setName]=useState(s.preferences.accountName),[busy,setBusy]=useState(false);
  const active=identity?.workspaces.find(w=>w.id===identity.activeWorkspaceId),[workspaceName,setWorkspaceName]=useState(active?.name??"");
  const admin=!identity||capabilities?.includes("workspace.settings");
  return <div className="settings-reference account-reference">
    <h1>Conta</h1><p className="subtitle">Quem você é no app e pra onde vão cobranças, avisos e relatórios</p>
    <section className="settings-reference-panel">
      <header className="settings-reference-panel-head"><span className="settings-reference-symbol"><UserRound size={20}/></span><div><h2>Perfil</h2><p>Como você aparece no app e o fuso que agenda seus envios.</p></div></header>
      <form className="settings-reference-panel-body" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);const ok=await run(async()=>{if(identity){const result=await authClient.updateUser({name});if(result.error)throw Error(result.error.message??"Não foi possível salvar o perfil.");}await repo.updatePreferences({...(!identity?{accountName:name}:{}),...(admin?{company:p.company,timezone:p.timezone}:{})});},"Perfil salvo.");setBusy(false);if(ok&&identity)location.reload();}}>
        <div className="profile-avatar-row"><span className="large-avatar">{name.slice(0,1)}</span><div><Button type="button" disabled title="Envio de foto ainda não disponível">Trocar foto</Button><small>Envio de foto ainda não disponível.</small></div></div>
        <div className="settings-reference-grid"><Field label="Nome"><input required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></Field><Field label="Empresa"><input disabled={!admin} maxLength={100} placeholder="Opcional" value={p.company} onChange={e=>setP({...p,company:e.target.value})}/></Field><Field label="Fuso horário"><select disabled={!admin} value={p.timezone} onChange={e=>setP({...p,timezone:e.target.value})}>{timezones.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field><Field label="E-mail de login" help="É o seu usuário; pra trocar, fale com o suporte."><input disabled value={identity?.user.email??"Conta demonstrativa"}/></Field></div>
        <div className="form-actions"><Button variant="primary" icon="Save" disabled={busy}>Salvar</Button></div>
      </form>
    </section>
    <section className="settings-reference-panel"><header className="settings-reference-panel-head"><span className="settings-reference-symbol"><ContactRound size={20}/></span><div><h2>Contatos da conta</h2><p>Pra onde vão as cobranças e os avisos. Cada um pode ser diferente do e-mail de login.</p></div></header><div className="settings-reference-panel-body">
      {identity?.activeWorkspaceId?<AccountBilling key={identity.activeWorkspaceId} workspaceId={identity.activeWorkspaceId} email={identity.user.email}/>:<p>O contato de cobrança está disponível no modo autenticado.</p>}
      <div className="settings-contact-block" id="aviso-whatsapp"><h3>Avisos no WhatsApp</h3><p>O número que recebe os avisos. Quais avisos, você escolhe em <Link href="/settings/notifications">Notificações</Link>.</p><Field label="Seu WhatsApp" help="O cadastro de número para avisos ainda não está disponível."><input type="tel" disabled placeholder="(11) 98765-4321"/></Field><div className="form-actions"><Button disabled>Salvar número</Button></div></div>
      <p className="settings-reference-footnote">Senha e dispositivos ficam em <Link href="/settings/security">Segurança</Link>; quem mais acessa a conta, em <Link href="/settings/seats">Membros</Link>.</p>
    </div></section>
    <section className="settings-reference-panel"><header className="settings-reference-panel-head"><span className="settings-reference-symbol"><Icon name="Mail" size={20}/></span><div><h2>Relatórios por e-mail</h2><p>Preferências de resumo da prospecção. O envio de relatórios ainda não está integrado.</p></div></header><form className="settings-reference-panel-body settings-report-preferences" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);await run(()=>repo.updatePreferences({dailyReport:p.dailyReport,weeklyReport:p.weeklyReport,monthlyReport:p.monthlyReport}),"Preferências salvas.");setBusy(false);}}><Toggle label="Resumo diário" description="Todo dia às 8h, com os números do dia anterior." checked={p.dailyReport} onChange={v=>setP({...p,dailyReport:v})}/><Toggle label="Resumo semanal" description="Toda segunda-feira, com os últimos 7 dias." checked={p.weeklyReport} onChange={v=>setP({...p,weeklyReport:v})}/><Toggle label="Resumo mensal" description="Todo dia 1º, com o mês fechado." checked={p.monthlyReport} onChange={v=>setP({...p,monthlyReport:v})}/><div className="form-actions"><Button icon="Save" disabled={busy}>Salvar</Button></div></form></section>
    {identity&&<details className="settings-reference-panel workspace-reference"><summary>Workspace</summary><form className="settings-reference-panel-body" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);if(await run(()=>identityPost({type:"rename",name:workspaceName},identity.activeWorkspaceId??undefined),"Nome do workspace salvo."))location.reload();setBusy(false);}}><Field label="Nome do workspace"><input required minLength={2} maxLength={100} disabled={!admin} value={workspaceName} onChange={e=>setWorkspaceName(e.target.value)}/></Field><div className="form-actions"><Button variant="primary" disabled={!admin||busy}>Salvar workspace</Button></div></form></details>}
    {!admin&&<Notice>Empresa e fuso são administrados pelo proprietário ou administrador.</Notice>}
  </div>;
}
