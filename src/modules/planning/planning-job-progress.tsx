"use client";
import {useState} from 'react';
import type {JobView} from '@/domain/prospecting';
import {useIdentity} from '@/client/workspace-provider';
import {planningTaskLabels} from '@/domain/planning';
import {AnalysisStatus,usePlanningAnalysis} from './analysis-status';
import {SourceList} from './source-list';
import {Button,PageHeader,Notice,LinkButton} from '@/components/ui/primitives';
import {ReconciliationReview} from '@/modules/prospecting/reconciliation-review';
import {RetainedResults} from '@/modules/prospecting/retained-results';
export function PlanningJobProgress({job}:{job:JobView}){
 const analysis=usePlanningAnalysis(job.id),[reconcile,setReconcile]=useState(false),identity=useIdentity(),role=identity?.workspaces.find(w=>w.id===identity.activeWorkspaceId)?.role;
 const current=analysis.data?.job??job,proposal=analysis.data?.proposal,request=analysis.data?.request;
 const wizard=job.task==='audience_plan'?'/automations/new/ai?job='+encodeURIComponent(job.id):job.task==='cadence_options'?'/cadences/new/ai?job='+encodeURIComponent(job.id):job.task==='message_preview'&&request?.task==='message_preview'?'/cadences/'+encodeURIComponent(request.cadenceId):'/settings/context';
 return <><PageHeader title={planningTaskLabels[job.task!]??'Análise de IA'} back="/executions" description="O resultado é uma proposta. Nenhuma lista, automação, cadência ou mensagem é criada por esta análise."/><AnalysisStatus data={analysis.data} error={analysis.error} onRefresh={analysis.refresh}/>
  {current.state==='needs_reconciliation'&&['owner','admin'].includes(role??'')&&<Button onClick={()=>setReconcile(true)}>Reconciliar chamada</Button>}
  <section className="panel panel-pad section-gap stack"><h2>Resultado</h2>{proposal?<>
   {'options' in proposal&&proposal.options.map(option=><article key={option.id}><h3>{'title' in option?option.title:option.name}</h3><p>{option.description}</p>{'steps' in option&&option.steps.map((step,i)=><p className="message-preview" key={i}>{step.subject}{step.subject?'\n':''}{step.body}</p>)}</article>)}
   {proposal.task==='context_read'&&Object.entries(proposal.fields).map(([key,field])=><article key={key}><h3>{key}</h3><p>{field?.value||'Não encontrado'}</p>{field?.quote&&<blockquote>{field.quote}</blockquote>}</article>)}
   {proposal.task==='message_preview'&&<p className="message-preview">{proposal.subject}{proposal.subject?'\n':''}{proposal.body}</p>}
   <LinkButton variant="primary" href={wizard}>{'options' in proposal?'Retomar propostas sem nova geração →':'Abrir editor para revisar →'}</LinkButton>
  </>:<Notice>A proposta aparece depois de uma resposta válida. Falhas não produzem conteúdo demonstrativo.</Notice>}<SourceList sources={analysis.data?.sources??[]}/></section>
  <section className="panel panel-pad section-gap"><h3>Uso registrado</h3>{current.usage?.map(u=><p key={u.operationId}>{u.provider} · {Object.entries(u.units).map(([unit,n])=>`${n} ${unit}`).join(', ')} · {u.costUsd===null?'custo monetário desconhecido':`US$ ${u.costUsd}`}</p>)}</section>
  <RetainedResults job={current}/>{reconcile&&<ReconciliationReview job={current} onClose={()=>setReconcile(false)} onDone={()=>{setReconcile(false);analysis.refresh();}}/>}
 </>;
}
