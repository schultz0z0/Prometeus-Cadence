"use client";
import { SelectField } from "@/components/ui/select-field";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useProspecting,useWorkspaceRefresh} from '@/client/workspace-provider';
import {useLiveRefresh} from '@/client/use-live-refresh';
import {brazilianStates,type JourneyInput,type JourneyReview,type JourneyView} from '@/domain/prospecting-journey';
import type {PlanningReview} from '@/domain/planning';
import {Button,Field,Modal,Notice,Badge,LinkButton} from '@/components/ui/primitives';
import {AnalysisReview} from '@/modules/planning/analysis-review';
import {jobStateLabels} from './job-history';
const labels={discover:'Buscar empresas',research:'Investigar empresas',people:'Identificar decisores',qualify:'Qualificar',review:'Revisar resultados',cadence:'Preparar cadência'};
function JourneyReviewDialog({review,busy,error,onClose,onConfirm}:{review:JourneyReview;busy:boolean;error:string;onClose:()=>void;onConfirm:()=>void}){
 const funding=review.input.funding==='credits'?'Créditos adicionais':'Franquia do plano';
 return <Modal title="Revisar prospecção completa" onClose={onClose}><div className="stack">
  <p><strong>{review.input.brief}</strong> · {review.input.location} · até {review.input.limit} empresas</p>
  {review.input.registry&&<p>Origem · Base CNPJ ativa · CNAE {review.input.registry.cnae}. O Maps confirma o estabelecimento. A busca web ajuda quando faltar um site verificável.</p>}
  <p>Saldo de captação · {funding}{review.extractionRemaining!=null&&` · ${review.extractionRemaining} disponíveis hoje`}.</p>
  {review.effects.map(e=><p key={e}>{e}</p>)}
  {review.warnings.map(w=><small key={w}>{w}</small>)}
  {review.blockers.map(b=><Notice key={b}>{b}</Notice>)}
  {error&&<p className="error-bar" role="alert">{error}</p>}
  <div className="form-actions"><Button disabled={busy} onClick={onClose}>Voltar</Button><Button variant="primary" disabled={busy||!!review.blockers.length} onClick={onConfirm}>{busy?'Confirmando…':'Confirmar prospecção'}</Button></div>
 </div></Modal>;
}
type UF=keyof typeof brazilianStates;
const isUf=(value:string):value is UF=>Object.hasOwn(brazilianStates,value);

export function JourneyStart({onClose,initial,initialCnae,initialUf}:{onClose:()=>void;initial?:Partial<JourneyInput>;initialCnae?:string;initialUf?:string}){
 const client=useProspecting();
 const [brief,setBrief]=useState(initial?.brief??'');
 const [limit,setLimit]=useState(initial?.limit??10);
 const [funding,setFunding]=useState(initial?.funding??'plan');
 const [,locationCity,locationUf]=initial?.location?.match(/^(.+?)\s*[,/–-]\s*([a-z]{2})$/i)??[];
 const [city,setCity]=useState(initial?.registry?.city??locationCity??initial?.location??'');
 const [uf,setUf]=useState(initial?.registry?.uf??initialUf??locationUf?.toUpperCase()??'');
 const [cnae,setCnae]=useState(initial?.registry?.cnae??initialCnae??'');
 const [review,setReview]=useState<JourneyReview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);

 async function run(confirm=false){
  if(!client||busy)return;
  setBusy(true);setError('');
  try{
   if(confirm&&review){
    const journey=await client.confirmJourney(review);
    window.location.assign('/executions/'+journey.stages[0].jobId);
   }else{
    if(!isUf(uf)){setError('Selecione a UF da busca.');return;}
    setReview(await client.prepareJourney({brief,location:city.trim()+', '+uf,limit,funding,
      ...(initial?.destinationListId?{destinationListId:initial.destinationListId}:{}),registry:{cnae,city,uf}}));
   }
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }

 if(review)return <JourneyReviewDialog review={review} busy={busy} error={error} onClose={()=>{if(!busy)setReview(null);}} onConfirm={()=>void run(true)}/>;
 return <Modal title="Prospecção completa" description="Do público que você procura aos resultados prontos para revisar." onClose={()=>{if(!busy)onClose();}}>
  <form className="stack" onSubmit={e=>{e.preventDefault();void run();}}>
   <Field label="Quem você quer alcançar"><textarea required minLength={2} maxLength={4000} rows={3} value={brief} onChange={e=>setBrief(e.target.value)} placeholder="Ex.: clínicas odontológicas com mais de uma unidade"/></Field>
   <Field label="CNAE principal"><input required inputMode="numeric" pattern="[0-9]{7}" maxLength={7} value={cnae} onChange={e=>setCnae(e.target.value.replace(/\D/g,''))} placeholder="Ex.: 8630504"/></Field>
   <Field label="Município"><input required minLength={2} maxLength={120} value={city} onChange={e=>setCity(e.target.value)} placeholder="Ex.: Rio de Janeiro"/></Field>
   <Field label="Estado (UF)"><SelectField value={uf} required onChange={e=>setUf(e.target.value)}><option value="">Selecione a UF</option>{Object.entries(brazilianStates).map(([code,state])=><option value={code} key={code}>{code} · {state}</option>)}</SelectField></Field>
   <Field label="Máximo de empresas"><input required type="number" min={1} max={500} value={limit} onChange={e=>setLimit(Number(e.target.value))}/></Field>
   <Field label="Saldo para extrações"><SelectField value={funding} onChange={e=>setFunding(e.target.value==='credits'?'credits':'plan')}><option value="plan">Franquia do plano</option><option value="credits">Créditos adicionais</option></SelectField></Field>
   <Notice>A busca começa por CNPJs ativos do município e CNAE indicados. A investigação e a qualificação usam o contexto aprovado da sua empresa. Você revisa os resultados e a cadência antes de qualquer envio.</Notice>
   {error&&<p role="alert" className="error-bar">{error}</p>}
   <div className="form-actions"><Button type="button" disabled={busy} onClick={onClose}>Cancelar</Button><Button type="submit" variant="primary" disabled={busy}>{busy?'Preparando…':'Revisar prospecção'}</Button></div>
  </form>
 </Modal>;
}
export function JourneyProgress({jobId}:{jobId:string}){
 const client=useProspecting(),refreshWorkspace=useWorkspaceRefresh(),[journey,setJourney]=useState<JourneyView|null>(null),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[review,setReview]=useState<JourneyReview|null>(null),[cadenceReview,setCadenceReview]=useState<PlanningReview|null>(null),[channels,setChannels]=useState<'EMAIL'|'WHATSAPP'|'both'>('EMAIL');
 useEffect(()=>{let live=true;setJourney(null);setLoaded(false);client?.journeyForJob(jobId).then(j=>{if(live){setJourney(j);setLoaded(true);setError('');}}).catch(e=>{if(live){setError(e.message);setLoaded(true);}});return()=>{live=false;};},[client,jobId]);
 useLiveRefresh(async signal=>{if(!client||!journey)return;const j=await client.journey(journey.id);if(!signal.aborted){setJourney(j);setError('');}},15000,!!journey,jobId);
 async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();await refreshWorkspace?.();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(!loaded)return <p role="status" className="secondary-text">Carregando jornada…</p>;
 if(!journey)return error?<p className="error-bar" role="alert">{error}</p>:null;
 return <section className="panel panel-pad stack section-gap journey-progress" aria-label="Jornada da prospecção"><div className="row between wrap"><div><h2>Da prospecção à cadência</h2><p className="secondary-text">{journey.input.brief} · {journey.input.location}</p></div><Badge tone={journey.state==='ready'?'green':'neutral'}>{{running:'Em andamento',paused:'Pausada',blocked:'Revisão necessária',review:'Pronta para revisar',ready:'Rascunho criado'}[journey.state]}</Badge></div>
 <ol className="journey-stages">{journey.stages.map((s,i)=><li key={s.jobId??i}><span>{labels[s.name]}</span><div><Badge>{jobStateLabels[s.state as keyof typeof jobStateLabels]??s.state}</Badge>{s.companies>0&&<small>{s.companies} empresas</small>}{s.jobId&&s.jobId!==jobId&&<Link href={'/executions/'+s.jobId}>Ver resultados</Link>}</div></li>)}</ol>
 {journey.reason&&<Notice>{journey.reason==='WAITING_CAPACITY'?<span role="status">Aguardando capacidade de processamento. A prospecção continua automaticamente.</span>:journey.reason==='NEEDS_RECONCILIATION'?'Uma chamada está incerta. Confira a operação antes de retomar.':journey.reason==='EMPTY_RESULT'?'Nenhuma empresa nova disponível para esta jornada. Revise o público e a localização.':'O contexto, as fontes ou a capacidade precisam ser revisados. Os resultados já obtidos foram preservados.'}</Notice>}
 {journey.missing>0&&<Notice>{journey.missing} empresa(s) com informações parciais na investigação, pessoas ou qualificação. Resultados disponíveis foram preservados. A retomada consulta apenas falhas recuperáveis; ausência de dados públicos continua identificada.</Notice>}
 {!!journey.excluded&&<Notice>{journey.excluded} empresa(s) já existem em outra lista. Os contatos originais foram preservados e não serão duplicados. Esta jornada segue com as empresas da lista de destino.</Notice>}
 <div className="row wrap">{journey.listId&&<LinkButton href={'/contacts?list='+encodeURIComponent(journey.listId)}>Ver contatos</LinkButton>}{journey.state==='running'&&<Button disabled={busy} onClick={()=>void run(async()=>setJourney(await client!.pauseJourney(journey.id)))}>Pausar jornada</Button>}{['paused','blocked','review'].includes(journey.state)&&!journey.cadenceId&&<Button disabled={busy} onClick={()=>void run(async()=>setReview(await client!.prepareJourneyResume(journey.id)))}>Revisar retomada</Button>}{journey.cadenceId&&<LinkButton href={'/cadences/'+journey.cadenceId}>Abrir rascunho</LinkButton>}</div>
 {journey.state==='review'&&!journey.cadenceId&&<div className="stack"><p>Revise os fatos e a qualificação nas etapas acima antes de montar as mensagens.</p><Field label="Canais da cadência"><SelectField value={channels} onChange={e=>setChannels(e.target.value as typeof channels)}><option value="EMAIL">E-mail</option><option value="WHATSAPP">WhatsApp</option><option value="both">E-mail e WhatsApp</option></SelectField></Field><small>A conexão, os limites e a autorização de cada contato são conferidos novamente antes da publicação. Uma análise falhada, cancelada ou com contexto desatualizado pode ser substituída após nova revisão.</small><div><Button variant="primary" disabled={busy} onClick={()=>void run(async()=>setCadenceReview(await client!.prepareJourneyCadence(journey.id,channels==='both'?['EMAIL','WHATSAPP']:[channels])))}>{journey.proposalJobId?'Revisar nova análise':'Sugerir cadência'}</Button></div></div>}
 {journey.proposalJobId&&!journey.cadenceId&&<LinkButton variant="primary" href={'/cadences/new/ai?job='+journey.proposalJobId}>Revisar sugestões de cadência →</LinkButton>}
 {error&&<p className="error-bar" role="alert">{error}</p>}
 {review&&<JourneyReviewDialog review={review} busy={busy} error={error} onClose={()=>{if(!busy)setReview(null);}} onConfirm={()=>void run(async()=>{setJourney(await client!.resumeJourney(journey.id,review));setReview(null);})}/>}
 {cadenceReview&&<AnalysisReview review={cadenceReview} busy={busy} error={error} onClose={()=>{if(!busy)setCadenceReview(null);}} onConfirm={()=>void run(async()=>{setJourney(await client!.confirmJourneyCadence(journey.id,cadenceReview));setCadenceReview(null);})}/>}
 </section>;
}
