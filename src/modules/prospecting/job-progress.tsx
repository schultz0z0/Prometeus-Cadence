"use client";
import {useEffect,useState} from 'react';
import {useLiveRefresh} from '@/client/use-live-refresh';
import {useIdentity,useProspecting} from '@/client/workspace-provider';
import type {JobView} from '@/domain/prospecting';
import {Button,PageHeader,Badge,Notice} from '@/components/ui/primitives';
import {ReconciliationReview} from './reconciliation-review';
import {JobResults} from './job-results';
import {jobStateLabels} from './job-history';
import {PlanningJobProgress} from '@/modules/planning/planning-job-progress';
import {RetainedResults} from './retained-results';
const activeStates=['queued','running','waiting_provider','cancelling'];
export function useProspectingJob(id:string){
  const client=useProspecting(),[job,setJob]=useState<JobView|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true;setJob(null);
    client?.get(id).then(next=>{if(active){setJob(next);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
  },[client,id,revision]);
  useLiveRefresh(async signal=>{if(!client)return;try{const next=await client.get(id);if(!signal.aborted){setJob(next);setError('');}}catch(e){if(!signal.aborted)setError((e as Error).message);throw e;}},5000,!!client,client? id:'');
  return{job,error,refresh:()=>setRevision(r=>r+1)};
}
export function JobProgress({id}:{id:string}){
  const client=useProspecting(),identity=useIdentity(),{job,error,refresh}=useProspectingJob(id),[actionError,setActionError]=useState(''),[busy,setBusy]=useState(false),[reconcile,setReconcile]=useState(false);
  const role=identity?.workspaces.find(w=>w.id===identity.activeWorkspaceId)?.role;
  async function cancel(){if(!client||busy)return;setBusy(true);setActionError('');try{await client.cancel(id);refresh();}catch(e){setActionError(e instanceof Error?e.message:'Falha ao cancelar.');}finally{setBusy(false);}}
  if(!job)return <><PageHeader title="Execução" back="/executions"/><p role={error?'alert':'status'}>{error||'Carregando execução…'}</p></>;
  if(job.kind==='planning')return <PlanningJobProgress job={job}/>;
  return <><PageHeader title={job.enrichment?'Enriquecimento de decisores':job.kind==='generation'?'Busca de empresas':'Qualificação de leads'} description={`Fonte ${job.source} · ${new Date(job.createdAt).toLocaleString('pt-BR')}`} back="/executions" actions={<><Button disabled={busy} onClick={refresh} icon="RefreshCw">Atualizar</Button>{activeStates.includes(job.state)&&<Button disabled={busy||job.state==='cancelling'} onClick={cancel}>{job.state==='cancelling'?'Aguardando cancelamento':'Cancelar execução'}</Button>}</>}/>
    {job.purpose==='ai-connection-test'?<Notice>Teste de conexão com evidência sintética. Pode consumir uma chamada real da LLM convencional, conforme o uso registrado. Nenhuma proposta deste teste será aplicada.</Notice>:job.testFixture&&<Notice>Validação com dados sintéticos. Esta execução usa fixtures de QA e não comprova uma chamada real ao provedor.</Notice>}
    {job.aiRoute&&<p className="secondary-text">{job.aiRoute.effectiveMode==='hybrid'?'JEV + LLM convencional':'LLM convencional'} · {job.aiRoute.conventional.provider} · {job.aiRoute.conventional.model}{identity?.platformAiAdmin&&<> · <a href="/settings/ai">Administrar IA da plataforma</a></>}</p>}
    {(error||actionError)&&<p role="alert" className="error-bar">{error||actionError}</p>}
    <section className="panel panel-pad stack"><div className="row between wrap"><h2>Progresso</h2><Badge tone={job.state==='completed'?'green':job.state==='failed'?'red':'neutral'}>{jobStateLabels[job.state]}</Badge></div><div className="row wrap"><span>{job.counts.found} encontrados</span><span>{job.counts.inserted} inseridos</span><span>{job.counts.duplicates} duplicados</span><span>{job.counts.rejected} rejeitados</span><span>{job.counts.pending} para revisão</span></div>
      {job.state==='queued'&&<Notice>A execução está na fila. O worker precisa estar ativo para iniciar o processamento. Nenhum resultado é simulado nesta conta.</Notice>}
      {job.state==='partial'&&<Notice>Parte do processamento foi confirmada. Os resultados preservados estão abaixo; revise a falha antes de iniciar outra execução.</Notice>}
      {job.state==='cancelling'&&<Notice>O cancelamento foi solicitado. Estamos aguardando a confirmação do provedor; isso não garante estorno de uso.</Notice>}
      {job.error&&<p role="alert">{job.error.message} <small>Referência: {job.error.code}</small></p>}
      {job.state==='needs_reconciliation'&&<Notice>A resposta de uma operação externa ficou incerta. O sistema não repetirá a chamada automaticamente. Um administrador precisa conferir o provedor antes de retomar.</Notice>}
      {job.state==='needs_reconciliation'&&['owner','admin'].includes(role??'')&&<Button onClick={()=>setReconcile(true)}>Reconciliar chamada</Button>}
      {job.enrichment&&job.outputListId&&<a className="btn" href={'/contacts?list='+encodeURIComponent(job.outputListId)}>Abrir lista de decisores →</a>}
      {job.listId&&<a className="btn" href={'/contacts?list='+encodeURIComponent(job.listId)}>Abrir lista atualizada →</a>}
    </section>
    <section className="panel panel-pad section-gap"><h3>Uso registrado</h3>{job.usage?.length?job.usage.map(u=><p className="secondary-text section-gap" key={u.operationId}>{u.provider} · {Object.entries(u.units).map(([unit,count])=>`${count} ${unit}`).join(', ')} · {u.costUsd===null?'custo monetário desconhecido':`US$ ${u.costUsd} (${u.costKind})`}</p>):<p className="muted section-gap">Ainda não há consumo registrado. Operações incertas podem continuar com reserva retida.</p>}</section>
    <RetainedResults job={job}/><JobResults job={job}/>
    {reconcile&&<ReconciliationReview job={job} onClose={()=>setReconcile(false)} onDone={()=>{setReconcile(false);refresh();}}/>}
  </>;
}
