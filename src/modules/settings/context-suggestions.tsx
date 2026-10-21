"use client";
import {useState} from 'react';
import {usePlanning} from '@/client/workspace-provider';
import type {CompanyProfile} from '@/domain/model';
import type {ContextField,PlanningReview} from '@/domain/planning';
import {contextFields} from '@/domain/planning';
import {emptyWorkspace} from '@/domain/empty-workspace';
import {mergeContextFields} from '@/domain/context';
import {Button,Modal,Notice} from '@/components/ui/primitives';
import {AnalysisReview} from '@/modules/planning/analysis-review';
import {AnalysisStatus,usePlanningAnalysis} from '@/modules/planning/analysis-status';
import {SourceList} from '@/modules/planning/source-list';
const labels:Record<ContextField,string>={name:'Nome',offer:'Oferta',products:'Produtos e serviços',idealCustomer:'Cliente ideal',pains:'Dores',differentiators:'Diferenciais',competitors:'Concorrentes',socialProof:'Prova social',sources:'Outros detalhes'};
export function ContextSuggestions({current,onChange,productId,onAccepted}:{current:CompanyProfile;onChange:(p:CompanyProfile)=>void;productId?:string;onAccepted?:(jobId:string)=>void}){
 const client=usePlanning(),[review,setReview]=useState<PlanningReview|null>(null),[jobId,setJobId]=useState<string|null>(null),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<ContextField[]>([]),[conflicts,setConflicts]=useState<ContextField[]>([]);
 const analysis=usePlanningAnalysis(jobId),proposal=analysis.data?.proposal;
 async function prepare(){if(!client)return;setBusy(true);setError('');try{setReview(await client.prepare({kind:'planning',task:'context_read',domain:current.domain,target:productId?{kind:'product',productId}:{kind:'company'}}));}catch(e){setError(e instanceof Error?e.message:'Falha ao preparar leitura.');}finally{setBusy(false);}}
 async function confirm(){if(!client||!review)return;setBusy(true);setError('');try{const job=await client.confirm(review);setJobId(job.id);setSelected([]);setConflicts([]);setReview(null);setVisible(true);}catch(e){setError(e instanceof Error?e.message:'Não foi possível iniciar.');}finally{setBusy(false);}}
 function accept(){if(!analysis.data||proposal?.task!=='context_read')return;
  const base={...emptyWorkspace().companyProfile,...analysis.data.baseline};
  const merged=mergeContextFields(base,proposal.fields,current,selected);setConflicts(merged.conflicts);onChange(merged.draft);onAccepted?.(analysis.data.job.id);
 }
 return <><Button disabled={busy||!current.domain.trim()} onClick={prepare}>Reler{productId?' produto':''}</Button>{jobId&&<Button variant="ghost" onClick={()=>setVisible(true)}>Ver análise</Button>}
  {error&&!review&&<small role="alert">{error}</small>}
  {review&&<AnalysisReview review={review} busy={busy} error={error} onClose={()=>{if(!busy)setReview(null);}} onConfirm={confirm}/>}
  {visible&&jobId&&<Modal wide title="Revisar leitura do site" onClose={()=>setVisible(false)} description="Compare as fontes e escolha os campos. Aceitar altera somente o formulário.">
   <AnalysisStatus data={analysis.data} error={analysis.error} onRefresh={analysis.refresh}/>
   {proposal?.task==='context_read'&&<div className="stack section-gap">
    <Notice>Se você editou um campo durante a leitura, sua edição é preservada. Salvar e aprovar continuam sendo ações separadas.</Notice>
    {contextFields.filter(field=>Object.hasOwn(proposal.fields,field)).map(field=>{
     const suggestion=proposal.fields[field]!;return <article className="panel panel-pad stack" key={field}>
      <label className="row"><input type="checkbox" checked={selected.includes(field)} onChange={e=>setSelected(v=>e.target.checked?[...v,field]:v.filter(f=>f!==field))}/><strong>{labels[field]}</strong></label>
      <small>Original: {String((analysis.data?.baseline as Partial<CompanyProfile>|null)?.[field]??'Não informado')}</small>
      <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>Sugestão: {suggestion.value||'Não encontrado nas fontes'}</p>
      <small>Seu texto atual: {current[field]||'Não informado'}</small>
      {suggestion.quote&&<blockquote>{suggestion.quote}</blockquote>}
      {conflicts.includes(field)&&<p role="alert">Este campo foi editado durante a leitura. Seu texto foi mantido; compare e edite manualmente.</p>}
     </article>;
    })}
    <Button variant="primary" disabled={!selected.length||!['completed','partial'].includes(analysis.data?.job.state??'')} onClick={accept}>Aceitar campos no rascunho</Button>
    <SourceList sources={analysis.data?.sources??[]}/>
   </div>}
  </Modal>}
 </>;
}
