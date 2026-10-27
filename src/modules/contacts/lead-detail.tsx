"use client";
import { useState,useEffect } from "react";
import Link from "next/link";
import { useDemo, useRepository, useAction } from "@/demo/provider";
import { sourceLabels, qualificationLabels, qualificationTones } from "@/domain/model";
import { Badge, Button, LinkButton, EmptyState } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import {CompanyResearchCard} from '@/modules/research/company-research';
import { LeadDialog } from "./lead-dialog";
import {useProspecting} from '@/client/workspace-provider';import type {ContactEnrichment} from '@/domain/enrichment';
import type {ProspectingClient} from '@/client/prospecting-client';
function ContactEnrichmentCard({id,anchor}:{id:string;anchor:string}){
 const client=useProspecting(),[result,setResult]=useState<{client:ProspectingClient;id:string;anchor:string;data:ContactEnrichment|null}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setError('');client?.contactEnrichment(id).then(data=>{if(active)setResult({client,id,anchor,data});}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[client,id,anchor,retry]);
 const data=result?.client===client&&result.id===id&&result.anchor===anchor?result.data:undefined;
 return <section className="panel"><h3><Icon name="Sparkles" size={16}/>Enriquecimento</h3>{error?<p role="alert">{error} <Button onClick={()=>setRetry(n=>n+1)}>Tentar novamente</Button></p>:client&&data===undefined?<p role="status">Consultando evidências…</p>:data?<div className="enrichment-results stack">{data.people.map((p,i)=><div className="stack" key={i}><strong>{p.name} · {p.role}</strong>{p.email&&<span>{p.email}</span>}{p.phone&&<span>{p.phone}</span>}<small>Dados publicados; caixa e atividade de WhatsApp não verificadas.</small><details><summary>Fonte do contato</summary><blockquote>{p.quote}</blockquote><a href={p.sourceUrl} target="_blank" rel="noreferrer">{p.sourceUrl}</a></details></div>)}<Link href={'/executions/'+data.jobId}>Ver execução e aplicação ↗</Link></div>:<p>Sem decisor com evidência associado aos dados atuais deste contato.</p>}<Link href="/leads/enrich">Enriquecer a lista ↗</Link></section>;
}
function DetailValues({rows}: {rows: [string,string|undefined,string][]}) {
  return <dl className="lead-values">{rows.map(([label,value,icon])=><div key={label}><Icon name={icon} size={16}/><div><dt>{label}</dt><dd>{value||"Não informado"}</dd></div></div>)}</dl>;
}
export function LeadDetail({id}: {id:string}) {
  const s=useDemo(), repo=useRepository(), run=useAction();
  const [tab,setTab]=useState("Informações"),[edit,setEdit]=useState(false);
  const l=s.leads.find(lead=>lead.id===id);
  if(!l) return <EmptyState title="Contato não encontrado" description="O contato pode ter sido removido ou pertencer a outra base local."><LinkButton href="/contacts">Voltar para contatos</LinkButton></EmptyState>;
  const list=s.lists.find(x=>x.id===l.listId);
  return <div className="lead-reference">
    <header className="lead-reference-heading"><Link href="/contacts" aria-label="Voltar para contatos"><Icon name="ArrowLeft" size={20}/></Link><div><div className="row"><h1>{l.name}</h1><Button icon="Star" aria-label={l.favorite?"Remover dos favoritos":"Adicionar aos favoritos"} aria-pressed={!!l.favorite} onClick={()=>run(()=>repo.upsertLead({...l,favorite:!l.favorite}),l.favorite?"Favorito removido.":"Favorito adicionado.")}/></div><p>Lista: {list?.name??"—"} · Fonte: <strong>{sourceLabels[l.source]}</strong></p></div><Badge tone={qualificationTones[l.qualification]}>{qualificationLabels[l.qualification]}</Badge></header>
    <div className="lead-reference-actions"><Button variant="soft" icon="CheckCircle2" disabled={l.qualification==="qualified"} onClick={()=>run(()=>repo.upsertLead({...l,qualification:"qualified"}),"Contato aprovado.")}>{l.qualification==="qualified"?"Aprovado":"Aprovar"}</Button><Button icon="XCircle" disabled={l.qualification==="disqualified"} onClick={()=>run(()=>repo.upsertLead({...l,qualification:"disqualified"}),"Contato reprovado.")}>Reprovar</Button><Button icon="Pencil" onClick={()=>setEdit(true)}>Editar contato</Button></div>
    <div className="tabs" role="tablist" aria-label="Detalhes do contato">{["Informações","Execuções","Mensagens"].map((x,i)=><button role="tab" aria-selected={tab===x} key={x} className={tab===x?"active":""} onClick={()=>setTab(x)}><Icon name={["User","Send","Mail"][i]} size={16}/>{x}</button>)}</div>
    {tab==="Informações"?<div className="lead-reference-grid">
      <div className="stack"><section className="panel"><h3><Icon name="User" size={16}/>Contato</h3><DetailValues rows={[["E-mail",l.email,"Mail"],["Telefone",l.phone,"Phone"],["Site",l.site,"Globe"]]}/></section>
      <section className="panel"><h3><Icon name="MapPin" size={16}/>Localização</h3><DetailValues rows={[...(l.address?[["Endereço",l.address,"MapPin"] as [string,string,string]]:[]),["Cidade",l.city,"MapPin"],["Estado",l.state,"MapPin"]]}/></section>
      <CompanyResearchCard id={l.id} anchor={JSON.stringify([l.name,l.site,l.email,l.phone,l.summary])}/>
      <ContactEnrichmentCard id={l.id} anchor={JSON.stringify([l.name,l.companyName,l.cnpj,l.email,l.phone,l.site,l.city,l.state])}/></div>
      <section className="panel"><h3><Icon name="Building2" size={16}/>Dados Empresariais</h3><DetailValues rows={[["CNPJ",l.cnpj,"Hash"],["Razão Social",l.companyName,"Building2"],...(l.size?[["Porte",l.size,"Building2"] as [string,string,string]]:[]),...(l.cnae?[["CNAE",l.cnae,"Hash"] as [string,string,string]]:[]),...([['Capital social',l.capital,'Building2'],['Natureza jurídica',l.legalNature,'Building2'],['Data de abertura',l.openedAt,'Calendar'],['Avaliação informada',l.rating,'Star'],['Nº de avaliações informado',l.reviewCount,'Hash']] as [string,string|undefined,string][]).filter(([,value])=>!!value),["Fonte",sourceLabels[l.source],"Briefcase"]]}/>{Object.keys(l.customFields??{}).length>0&&<><h4>Campos personalizados</h4><DetailValues rows={Object.entries(l.customFields??{}).map(([key,value])=>[key,value,'FileText'])}/></>}{(l.instagram||l.facebook||l.linkedin||l.whatsapp)&&<><h4>Dados importados</h4><DetailValues rows={[["Instagram",l.instagram,"Globe"],["Facebook",l.facebook,"Globe"],["LinkedIn",l.linkedin,"Globe"],["WhatsApp informado",l.whatsapp,"Phone"]]}/></>}</section>
      <section className="panel lead-reference-summary"><h3><Icon name="FileText" size={16}/>Resumo & Status</h3><p>{l.summary||"Este lead ainda não tem resumo. Rode o qualificador para analisar o perfil."}</p><h4>Observação IA</h4><p>{l.reason||"Sem análise registrada."}</p><DetailValues rows={[["Situação na cadência","Consulte o pipeline da cadência","Activity"],["Criado em",new Date(l.createdAt).toLocaleString("pt-BR"),"Calendar"],["Fonte",sourceLabels[l.source],"MapPin"]]}/><div className="lead-reference-connection"><h4>CONEXÃO</h4><p>Consulte a caixa de mensagens para verificar as conversas deste contato.</p><Link href="/inbox">Abrir mensagens ↗</Link></div></section>
    </div>:<EmptyState icon={tab==="Mensagens"?"Mail":"Clock"} title="Histórico disponível nas áreas de mensagens e execuções" description="O histórico vinculado a este perfil ainda não está disponível. Consulte os registros do workspace nas áreas correspondentes."/>}
    {edit&&<LeadDialog lead={l} onClose={()=>setEdit(false)}/>}
  </div>;
}
