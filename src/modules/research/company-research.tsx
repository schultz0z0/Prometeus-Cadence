"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useDemo} from '@/demo/provider';
import {useResearch,useWorkspaceRefresh,useIdentity} from '@/client/workspace-provider';
import {Button,Field,Modal,Notice,Badge} from '@/components/ui/primitives';
import {Icon} from '@/components/ui/icon';
import type {CompanyResearchInput,ResearchApplication,ResearchCaseView,ResearchField} from '@/domain/company-research';
import type {Reviewed} from '@/domain/reviewed-operation';
import type {ResearchClient} from '@/client/research-client';

const labels:Record<ResearchField,string>={email:'E-mail',phone:'Telefone comercial',site:'Site',summary:'Contexto da empresa',instagram:'Instagram',facebook:'Facebook',linkedin:'LinkedIn da empresa',address:'Endereço',companyName:'Razão social'};
const missingLabels:Record<string,string>={SITE_NAO_ENCONTRADO:'Site não encontrado',BUSCA_SITE_INDISPONIVEL:'Busca de site indisponível',CONSULTA_CADASTRAL_INDISPONIVEL:'Consulta cadastral indisponível',CNPJ_NAO_INFORMADO:'Sem CNPJ informado',CADASTRO_DIVERGENTE:'Cadastro divergente',FONTE_PUBLICA_INVALIDA:'Fonte pública inválida',REDE_SOCIAL_INDISPONIVEL:'Rede social não acessível publicamente',PAGINA_INDISPONIVEL:'Página indisponível',LIMITE_DE_PAGINAS:'Limite de páginas alcançado',SEM_FONTE_PUBLICA:'Nenhuma fonte pública acessível',VINCULO_A_CONFIRMAR:'Vínculo de uma fonte ainda não comprovado'};
function canWrite(identity:ReturnType<typeof useIdentity>){return ['owner','admin','operator'].includes(identity?.workspaces.find(w=>w.id===identity.activeWorkspaceId)?.role??'');}

export function ResearchStart({leadIds,onClose}:{leadIds?:string[];onClose:()=>void}){
 const client=useResearch(),state=useDemo(),[listId,setListId]=useState(state.lists[0]?.id??''),[sources,setSources]=useState<CompanyResearchInput['sourceKinds']>(['website','social']),[pages,setPages]=useState(3),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [review,setReview]=useState<Awaited<ReturnType<ResearchClient['prepare']>>|null>(null);
 const selected=leadIds??state.leads.filter(l=>l.listId===listId).map(l=>l.id);
 async function prepare(){if(!client||busy)return;setBusy(true);setError('');try{setReview(await client.prepare({leadIds:selected,sourceKinds:sources,maxPagesPerCompany:pages}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function confirm(){if(!client||!review||busy)return;setBusy(true);setError('');try{const result=await client.confirm(review);location.assign('/executions/'+encodeURIComponent(result.id));}catch(e){setError((e as Error).message);setBusy(false);}}
 return <Modal key={review?'review':'setup'} title={review?'Revisar investigação':'Investigar empresa'} onClose={onClose} description="Conheça melhor a empresa antes de preparar sua abordagem."><div className="stack research-dialog">
  {review?<><p><strong>{review.input.leadIds.length} empresa(s)</strong> · até {review.input.maxPagesPerCompany} páginas por empresa.</p><p>A investigação só começa após confirmar. Você revisa os fatos antes de atualizar seus contatos.</p>{review.warnings.map((w,i)=><Notice key={i}>{w}</Notice>)}{review.blockers.map((w,i)=><p role="alert" key={i}>{w}</p>)}<div className="row wrap"><Button disabled={busy} onClick={()=>setReview(null)}>Voltar</Button><Button variant="primary" disabled={busy||!!review.blockers.length} onClick={confirm}>{busy?'Confirmando…':'Confirmar investigação'}</Button></div></>:<>
   {!leadIds&&<Field label="Lista de empresas"><select value={listId} onChange={e=>setListId(e.target.value)}>{state.lists.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>}
   <p>{selected.length} empresa(s) selecionada(s). Máximo de 500 por investigação.</p>
   <fieldset className="research-options"><legend>Onde investigar</legend>{([['website','Site da empresa'],['social','Redes sociais públicas'],['registry','Cadastro da empresa (CNPJ informado)']] as const).map(([kind,label])=><label key={kind}><input type="checkbox" checked={sources.includes(kind)} onChange={e=>setSources(v=>e.target.checked?[...v,kind]:v.filter(s=>s!==kind))}/><span>{label}</span></label>)}</fieldset>
   <Field label="Máximo de páginas por empresa" help="Até 10 páginas. Redes com acesso restrito podem não retornar informações."><input type="number" min={1} max={10} value={pages} onChange={e=>setPages(Number(e.target.value))}/></Field>
   <Notice>Contatos publicados não comprovam consentimento para mensagens nem atividade de WhatsApp. Nenhuma mensagem será enviada.</Notice>
   <Button variant="primary" disabled={busy||!selected.length||selected.length>500||!sources.length||pages<1||pages>10} onClick={prepare}>{busy?'Preparando revisão…':'Revisar investigação'}</Button>
  </>}{error&&<p role="alert" className="error-bar">{error}</p>}
 </div></Modal>;
}

export function CompanyResearchCard({id,anchor}:{id:string;anchor:string}){
 const client=useResearch(),identity=useIdentity(),[open,setOpen]=useState(false),[retry,setRetry]=useState(0),[error,setError]=useState('');
 const [loaded,setLoaded]=useState<{client:ResearchClient;id:string;anchor:string;data:ResearchCaseView|null}|null>(null);
 useEffect(()=>{let current=true;setError('');client?.latest(id).then(data=>{if(current)setLoaded({client,id,anchor,data});}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[client,id,anchor,retry]);
 const result=loaded?.client===client&&loaded.id===id&&loaded.anchor===anchor?loaded.data:undefined;
 return <section className="panel research-contact"><h3><Icon name="Globe" size={16}/>Investigação da empresa</h3>{error?<p role="alert">{error} <Button onClick={()=>setRetry(v=>v+1)}>Tentar novamente</Button></p>:result===undefined?<p role="status">Consultando investigação…</p>:result?<><p>{result.facts.length} fatos nesta empresa · {result.companies.find(c=>c.leadId===id)?.state==='partial'?'Fontes parcialmente disponíveis':'Veja o histórico e as fontes'}</p><Link href={'/executions/'+result.id+'?leadId='+encodeURIComponent(id)}>Ver investigação e fontes ↗</Link></>:<p>Pesquise fontes públicas e revise os dados encontrados antes de aplicar.</p>}{canWrite(identity)&&<Button icon="Search" onClick={()=>setOpen(true)}>Investigar empresa</Button>}{open&&<ResearchStart leadIds={[id]} onClose={()=>setOpen(false)}/>}</section>;
}

export function ResearchResults({id,revision}:{id:string;revision:number}){
 const client=useResearch(),identity=useIdentity(),refreshWorkspace=useWorkspaceRefresh(),state=useDemo(),[leadId,setLeadId]=useState(''),[refresh,setRefresh]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<string[]>([]),[review,setReview]=useState<Reviewed<ResearchApplication>|null>(null),[message,setMessage]=useState('');
 const [loaded,setLoaded]=useState<{client:ResearchClient;id:string;leadId:string;data:ResearchCaseView}|null>(null);
 useEffect(()=>{let current=true;setError('');client?.get(id,leadId||undefined).then(data=>{if(current)setLoaded({client,id,leadId,data});}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[client,id,leadId,revision,refresh]);
 const result=loaded?.client===client&&loaded.id===id&&loaded.leadId===leadId?loaded.data:null;
 async function prepare(){if(!client||!result||busy)return;setBusy(true);setError('');try{setReview(await client.prepareApplication({caseId:id,factIds:selected,expectedRevision:result.revision}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function apply(){if(!client||!review||busy)return;setBusy(true);setError('');try{const applied=await client.apply(review);setMessage(`${applied.applied} campo(s) atualizado(s).`);setSelected([]);setReview(null);setRefresh(v=>v+1);await refreshWorkspace?.();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="panel panel-pad section-gap research-results"><div className="row between wrap"><h2>Fatos e fontes da investigação</h2><Button disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Atualizar fatos</Button></div>
  {error&&<p role="alert" className="error-bar">{error}</p>}{message&&<p role="status">{message}</p>}
  {!result?<p role="status">{error?'Tente atualizar os fatos novamente.':'Carregando fatos…'}</p>:<>
   <Field label="Empresa"><select value={result.selectedLeadId??''} disabled={busy} onChange={e=>{setLeadId(e.target.value);setSelected([]);setReview(null);setMessage('');}}>{result.companies.map(c=><option key={c.leadId} value={c.leadId}>{c.name} · {c.state==='pending'?'Aguardando':c.state==='partial'?'Parcial':'Investigada'}</option>)}</select></Field>
   {!!result.companies.find(c=>c.leadId===result.selectedLeadId)?.missing.length&&<Notice>{result.companies.find(c=>c.leadId===result.selectedLeadId)!.missing.map(m=>missingLabels[m]??'Uma fonte precisa de revisão').join(' · ')}. Os fatos encontrados foram preservados.</Notice>}
   {!result.facts.length&&<p>Nenhum fato disponível nesta empresa. Acompanhe o progresso acima ou inicie uma nova investigação com dados mais completos.</p>}
   <div className="research-facts">{result.facts.map(f=>{const previous=state.leads.find(l=>l.id===f.leadId)?.[f.field];return <article className="research-fact" key={f.id}><label className="research-fact-choice"><input type="checkbox" disabled={busy||!canWrite(identity)||f.applied||f.attribution!=='company'||!['completed','partial'].includes(result.state)} checked={selected.includes(f.id)} onChange={e=>{setReview(null);setSelected(ids=>e.target.checked?[...ids.filter(id=>!result.facts.some(other=>other.id===id&&other.field===f.field)),f.id]:ids.filter(id=>id!==f.id));}}/><strong>{labels[f.field]}</strong><Badge tone={f.applied?'green':f.attribution==='company'?'neutral':'orange'}>{f.applied?'Aplicado':f.attribution==='company'?'Fonte vinculada':'Vínculo a confirmar'}</Badge></label><p className="research-value">{f.value}</p>{previous&&previous!==f.value&&<p className="secondary-text">Valor atual: {String(previous)}. A aplicação substituirá este campo.</p>}{f.evidence.map(e=><details key={e.id}><summary>Fonte · {new Date(e.fetchedAt).toLocaleDateString('pt-BR')}</summary><blockquote>{e.quote}</blockquote><a href={e.url} target="_blank" rel="noopener noreferrer">{e.url}</a></details>)}</article>;})}</div>
   {!!result.facts.length&&<><p className="secondary-text">Escolha os campos que deseja atualizar. Fatos com vínculo incerto ficam apenas na investigação.</p>{canWrite(identity)&&<div className="row wrap"><Button disabled={busy||!selected.length} onClick={()=>{setSelected([]);setReview(null);}}>Limpar seleção</Button><Button variant="primary" disabled={busy||!selected.length} onClick={prepare}>{busy?'Preparando…':`Revisar aplicação (${selected.length})`}</Button></div>}</>}
  </>}
  {review&&<Modal title="Revisar atualização dos contatos" onClose={()=>setReview(null)}><div className="stack"><p>{review.input.factIds.length} campo(s) selecionado(s). Campos com um valor atual diferente serão substituídos.</p>{result?.facts.filter(f=>review.input.factIds.includes(f.id)).map(f=><div key={f.id}><strong>{labels[f.field]}</strong><p className="research-value">{f.value}</p></div>)}{review.warnings.map((w,i)=><Notice key={i}>{w}</Notice>)}{error&&<p role="alert">{error}</p>}<Button variant="primary" disabled={busy} onClick={apply}>{busy?'Aplicando…':'Confirmar atualização'}</Button></div></Modal>}
 </section>;
}
