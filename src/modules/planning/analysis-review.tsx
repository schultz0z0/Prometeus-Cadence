"use client";
import type {PlanningReview,PlanningSelectionReview} from '@/domain/planning';
import {Modal,Button,Notice} from '@/components/ui/primitives';
export function AnalysisReview({review,busy,error,onConfirm,onClose}:{review:PlanningReview;busy:boolean;error?:string;onConfirm:()=>void;onClose:()=>void}){
 return <Modal title="Revisar análise de IA" onClose={onClose} description="A análise só começa ao confirmar este botão.">
  <div className="stack"><p>{review.input.task==='context_read'?'Leitura do site público':review.input.task==='audience_plan'?'Três propostas de público':review.input.task==='cadence_options'?'Três opções de cadência':'Prévia para um lead'}</p>
  {review.aiRoute&&<p>{review.aiRoute.conventional.provider} · {review.aiRoute.conventional.model}</p>}
  {review.usage.map(u=><p key={u.unit}>{u.maxUnits} chamada(s) · {u.provider} · {u.estimatedUsd===null?'custo monetário desconhecido':`US$ ${u.estimatedUsd}`}</p>)}
  {review.warnings.map(w=><small key={w}>{w}</small>)}
  {review.blockers.map(b=><Notice key={b}>{b}</Notice>)}
  {error&&<p role="alert" className="error-bar">{error}</p>}
  <div className="row end"><Button onClick={onClose} disabled={busy}>Voltar</Button><Button variant="primary" onClick={onConfirm} disabled={busy||review.blockers.length>0}>{busy?'Confirmando…':'Confirmar análise'}</Button></div></div>
 </Modal>;
}
export function SelectionReview({review,busy,error,onConfirm,onClose}:{review:PlanningSelectionReview;busy:boolean;error?:string;onConfirm:()=>void;onClose:()=>void}){
 return <Modal title="Confirmar criação" onClose={onClose}><div className="stack">{review.edits&&typeof review.edits==="object"&&"schedules" in review.edits?<div className="stack">{Object.entries(review.edits.schedules as Record<string,{anchorDate:string;time:string;timezone:string;weekdays:number[]}>).map(([key,schedule])=><p key={key}>{key==="search"?"Busca":"Qualificação"}: a partir de {schedule.anchorDate}, às {schedule.time} · {schedule.timezone} · dias {schedule.weekdays.map(d=>["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][d]).join(", ")}</p>)}</div>:null}{review.effects.map(effect=><p key={effect}>{effect}</p>)}{review.blockers.map(b=><Notice key={b}>{b}</Notice>)}{error&&<p role="alert">{error}</p>}<div className="row end"><Button disabled={busy} onClick={onClose}>Voltar</Button><Button variant="primary" disabled={busy||!!review.blockers.length} onClick={onConfirm}>{busy?'Criando…':'Confirmar criação'}</Button></div></div></Modal>;
}
