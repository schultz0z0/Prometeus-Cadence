"use client";
import {useState} from 'react';
import type {CadenceStep,Lead} from '@/domain/model';
import {mergeMessagePreview,renderStepPreview} from '@/domain/cadence';
import {usePlanningFlow} from './use-planning-flow';
import {AnalysisReview} from './analysis-review';
import {AnalysisStatus} from './analysis-status';
import {SourceList} from './source-list';
import {Button,Notice} from '@/components/ui/primitives';
export function MessagePreview({cadenceId,step,lead,onAccept,variant='A'}:{cadenceId:string;step:CadenceStep;lead:Lead;onAccept:(step:CadenceStep)=>void;variant?:'A'|'B'}){
 const flow=usePlanningFlow({kind:'planning',task:'message_preview',cadenceId,stepId:step.id,leadId:lead.id,variant}),[conflict,setConflict]=useState(false),proposal=flow.state.proposal;
 const rendered=proposal?.task==='message_preview'?renderStepPreview(proposal,lead):null;
 function accept(){if(proposal?.task!=='message_preview'||!flow.analysis.data?.previewStep)return;const merged=mergeMessagePreview(flow.analysis.data.previewStep,step,proposal);setConflict(merged.conflict);if(!merged.conflict)onAccept(merged.step);}
 return <section className="panel panel-pad section-gap stack"><h3>Prévia personalizada com IA</h3><small>Usa a etapa salva e somente o lead selecionado. Aceitar altera o editor; a mensagem não é enviada.</small><Button type="button" disabled={flow.busy} onClick={flow.prepare}>Revisar geração para {lead.name}</Button>
 {flow.state.error&&<p role="alert">{flow.state.error}</p>}
 {flow.state.jobId&&<AnalysisStatus data={flow.analysis.data} error={flow.analysis.error} onRefresh={flow.analysis.refresh}/>}
 {rendered&&<><p>{rendered.subject}</p><p className="message-preview">{rendered.text}</p>{rendered.unresolved.length>0&&<Notice>Variáveis sem dados: {rendered.unresolved.join(', ')}.</Notice>}{conflict&&<Notice>A etapa foi editada desde a versão usada na análise. Sua edição foi mantida. Compare e copie o trecho desejado manualmente.</Notice>}<Button type="button" disabled={!['completed','partial'].includes(flow.analysis.data?.job.state??'')} onClick={accept}>Aceitar no editor</Button><SourceList sources={flow.analysis.data?.sources??[]}/></>}
 {flow.state.review&&<AnalysisReview review={flow.state.review} busy={flow.busy} error={flow.state.error} onConfirm={flow.confirm} onClose={()=>{if(!flow.busy)flow.dispatch({type:'dismiss-review'});}}/>}
 </section>;
}
