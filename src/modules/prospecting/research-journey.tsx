"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useProspecting,useWorkspaceRefresh} from '@/client/workspace-provider';
import {useLiveRefresh} from '@/client/use-live-refresh';
import type {JourneyView} from '@/domain/prospecting-journey';
import {Button,Notice,Badge,LinkButton} from '@/components/ui/primitives';
import {jobStateLabels} from './job-history';
const labels={discover:'Buscar empresas',research:'Investigar empresas',people:'Identificar decisores',qualify:'Qualificar',review:'Revisar resultados',cadence:'Preparar cadência'};
export function JourneyProgress({jobId}:{jobId:string}){
 const client=useProspecting(),refreshWorkspace=useWorkspaceRefresh(),[journey,setJourney]=useState<JourneyView|null>(null),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;setJourney(null);setLoaded(false);client?.journeyForJob(jobId).then(j=>{if(live){setJourney(j);setLoaded(true);setError('');}}).catch(e=>{if(live){setError(e.message);setLoaded(true);}});return()=>{live=false;};},[client,jobId]);
 useLiveRefresh(async signal=>{if(!client||!journey)return;const j=await client.journey(journey.id);if(!signal.aborted){setJourney(j);setError('');}},15000,!!journey,jobId);
 async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();await refreshWorkspace?.();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(!loaded)return <p role="status" className="secondary-text">Carregando jornada…</p>;
 if(!journey)return error?<p className="error-bar" role="alert">{error}</p>:null;
 return <section className="panel panel-pad stack section-gap journey-progress" aria-label="Jornada da prospecção"><div className="row between wrap"><div><h2>Da prospecção à cadência</h2><p className="secondary-text">{journey.input.brief} · {journey.input.location}</p></div><Badge tone={journey.state==='ready'?'green':'neutral'}>{{running:'Em andamento',paused:'Pausada',blocked:'Revisão necessária',review:'Pronta para revisar',ready:'Rascunho criado'}[journey.state]}</Badge></div>
 <ol className="journey-stages">{journey.stages.map((s,i)=><li key={s.jobId??i}><span>{labels[s.name]}</span><div><Badge>{jobStateLabels[s.state as keyof typeof jobStateLabels]??s.state}</Badge>{s.companies>0&&<small>{s.companies} empresas</small>}{s.jobId&&s.jobId!==jobId&&<Link href={'/executions/'+s.jobId}>Ver resultados</Link>}</div></li>)}</ol>
 {journey.reason&&<Notice>{journey.reason==='WAITING_CAPACITY'?<span role="status">Aguardando capacidade de processamento. A prospecção continua automaticamente.</span>:journey.reason==='NEEDS_RECONCILIATION'?'Uma chamada está incerta. Confira a operação no histórico de execuções.':journey.reason==='LEGACY_JOURNEY_ARCHIVED'?'As etapas seguintes desta jornada não serão executadas. Os leads encontrados continuam na lista.':journey.reason==='EMPTY_RESULT'?'Nenhuma empresa nova disponível para esta jornada. Revise o público e a localização.':'O contexto, as fontes ou a capacidade precisam ser revisados. Os resultados já obtidos foram preservados.'}</Notice>}
 {journey.missing>0&&<Notice>{journey.missing} empresa(s) com informações parciais na investigação, pessoas ou qualificação. Resultados disponíveis foram preservados.</Notice>}
 {!!journey.excluded&&<Notice>{journey.excluded} empresa(s) já existem em outra lista. Os contatos originais foram preservados e não serão duplicados. Esta jornada segue com as empresas da lista de destino.</Notice>}
 {journey.state==='running'&&<Notice>Esta jornada integrada é histórica. Se você encerrá-la, ela não poderá ser retomada.</Notice>}
 {journey.state!=='running'&&journey.state!=='ready'&&<Notice>Esta jornada integrada está arquivada e não aceita novas etapas. Os resultados continuam na lista. Para seguir, use o Qualificador e o Enriquecedor.</Notice>}
 <div className="row wrap">{journey.listId&&<LinkButton href={'/contacts?list='+encodeURIComponent(journey.listId)}>Ver contatos</LinkButton>}{journey.state==='running'&&<Button disabled={busy} onClick={()=>void run(async()=>setJourney(await client!.pauseJourney(journey.id)))} title="Encerra as etapas em fila. Uma jornada arquivada não pode ser retomada.">Encerrar jornada</Button>}{journey.cadenceId&&<LinkButton href={'/cadences/'+journey.cadenceId}>Abrir rascunho</LinkButton>}</div>
 {journey.proposalJobId&&!journey.cadenceId&&<LinkButton variant="primary" href={'/cadences/new/ai?job='+journey.proposalJobId}>Revisar sugestões de cadência →</LinkButton>}
 {error&&<p className="error-bar" role="alert">{error}</p>}
 </section>;
}
