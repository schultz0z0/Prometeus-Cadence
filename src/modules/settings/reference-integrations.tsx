"use client";
import Link from "next/link";
import { Button, Field, Notice, LinkButton } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { MeetFlowPreview } from "./meetflow-preview";
import { ApolloConnection, useConnections } from "./apollo-connection";
import { SheetsConnection } from "./sheets-connection";
const apps=[
  {name:'FunnelsFlow CRM',slug:'funnelsflow',icon:'Workflow',color:'#ff6b00',description:'Leads gerados, qualificados ou que responderam viram contatos e negócios no CRM.'},
  {name:'Google Planilhas',slug:'google-sheets',icon:'Sheet',color:'#16a765',description:'Cada lead gerado, qualificado ou que respondeu vira uma linha na sua planilha.'},
  {name:'Apollo',slug:'apollo',icon:'Target',color:'#b59600',description:'Busque empresas usando sua conta e os créditos disponíveis no Apollo.'},
  {name:'MeetFlow',slug:'meetflow',icon:'Video',color:'#7c3aed',description:'Grave, transcreva e resuma suas reuniões de venda.'},
];
export function Integrations({subpage}:{subpage?:string}) {
  const {items:connections}=useConnections();
  const app=apps.find(a=>a.slug===subpage);
  if(subpage==='meetflow')return <MeetFlowPreview/>;
  if(subpage==='funnelsflow')return <div className="reference-settings funnelsflow-reference"><Link className="back-link" href="/settings/apps"><Icon name="ArrowLeft" size={14}/>Integrações</Link><div className="funnelsflow-heading"><span><Icon name="Workflow" size={26}/></span><div><h1>Nova Conta FunnelsFlow</h1><p>Conecte sua conta CRM para sincronizar leads e negócios</p></div></div><section className="funnelsflow-connection"><h2>Conexão</h2><Field label="Apelido da conta"><input disabled placeholder="Ex.: Conta principal"/></Field><Field label="Chave de API"><input disabled type="password" placeholder="Cole a chave de API da sua conta"/></Field><p className="muted">Este adaptador ainda não está disponível. Não informe credenciais nesta tela.</p><div className="form-actions"><Button disabled variant="primary">Conectar</Button></div></section></div>;
  if(subpage==='google-sheets')return <SheetsConnection/>;
  if(subpage==='apollo')return <div className="reference-settings integration-detail"><Link className="back-link" href="/settings/apps"><Icon name="ArrowLeft" size={14}/>CRM e apps</Link><h1>Apollo</h1><p className="subtitle">{app?.description}</p>
    <ApolloConnection/>
    <section className="reference-panel"><header><Icon name="Upload"/><h2>Prefere planilha?</h2></header><div className="reference-panel-body"><p>Importe os contatos que você já exportou do Apollo.</p><LinkButton href="/leads/import">Importar planilha do Apollo</LinkButton></div></section>
  </div>;
  return <div className="reference-settings integration-overview"><h1>CRM e apps</h1><p className="subtitle">Integrações nativas: o lead sai daqui e aparece lá, sem código.</p><div className="reference-integration-grid">{apps.map(a=><section className="reference-panel reference-integration" key={a.slug}><header><Icon name={a.icon} size={18}/><div className="grow"><h2>{a.name}</h2><p>{a.description}</p></div><small className="integration-status">{a.slug==='meetflow'?'Em preparação':connections?.some(c=>c.kind===a.slug)?'conectado':'não conectado'}</small></header><div className="reference-panel-body">{(()=>{const sheet=a.slug==='google-sheets'?connections?.find(c=>c.kind==='google-sheets')?.config:null;return sheet?<><p>Planilha <strong>{sheet.spreadsheetName}</strong> · <a href={`https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}`} target="_blank" rel="noreferrer">abrir no Google</a></p><LinkButton href="/settings/apps/google-sheets">Configurar <Icon name="ArrowRight" size={14}/></LinkButton></>:null;})()??<><p>{a.slug==='google-sheets'?'Conecte sua conta Google e escolha a planilha e a aba.':a.slug==='apollo'?'Use a chave da sua conta Apollo nas buscas do Gerador.':a.slug==='funnelsflow'?'Prepare a conexão do seu CRM quando o adaptador estiver disponível.':'Conheça a integração de reuniões e sua disponibilidade.'}</p><LinkButton variant={a.slug==='meetflow'?'':'primary'} href={'/settings/apps/'+a.slug}>{a.slug==='meetflow'?'Conhecer':'Conectar'} <Icon name="ArrowRight" size={14}/></LinkButton></>}</div></section>)}</div><section className="reference-panel"><header><Icon name="Workflow" size={18}/><div><h2>Outro sistema?</h2><p>Para n8n, Zapier, Make ou um CRM sem integração nativa, use os webhooks de saída.</p></div></header><div className="reference-panel-body"><Link href="/settings/webhooks">Webhooks e API →</Link></div></section></div>;
}
