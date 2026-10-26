"use client";
import {useState} from 'react';
import {useDemo} from '@/demo/provider';
import {usePlanningFlow} from '@/modules/planning/use-planning-flow';
import {AnalysisReview} from '@/modules/planning/analysis-review';
import {AnalysisStatus} from '@/modules/planning/analysis-status';
import {Button,Modal,Notice} from '@/components/ui/primitives';
import {audienceOptionToDraft,type GenerationDraft} from '@/domain/generation-draft';
export function NicheSuggestions({description,onClose,onApply}:{description:string;onClose:()=>void;onApply:(draft:GenerationDraft&{name:string;limit:number})=>void}){
 const workspace=useDemo(),flow=usePlanningFlow({kind:'planning',task:'audience_plan',description,channel:'both',timezone:workspace.preferences.timezone}),[error,setError]=useState('');
 const {state,busy}=flow,proposal=state.proposal,ready=flow.analysis.data&&['completed','partial'].includes(flow.analysis.data.job.state);
 if(state.review)return <AnalysisReview review={state.review} busy={busy} error={state.error} onConfirm={flow.confirm} onClose={()=>flow.dispatch({type:'dismiss-review'})}/>;
 return <Modal wide title="Sugestões de público com IA" description="Escolha uma hipótese para preencher o rascunho da busca." onClose={onClose}><div className="stack">
 <Notice>A análise usa o modelo conectado e pode ter custo. Não cria listas, contatos ou automações. A busca será revisada separadamente.</Notice>
 {(state.error||error)&&<p className="error-bar" role="alert">{state.error||error}</p>}
 {!state.jobId?<><p>{description}</p><div className="form-actions"><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={flow.prepare}>{busy?'Preparando revisão…':'Revisar análise de IA'}</Button></div></>:<AnalysisStatus data={flow.analysis.data} error={flow.analysis.error} onRefresh={flow.analysis.refresh}/>}
 {ready&&proposal?.task==='audience_plan'&&<div className="niche-options">{proposal.options.map(option=><section className="panel panel-pad stack" key={option.id}><h3>{option.title}</h3><p>{option.description}</p><small>{option.source} · {Object.entries(option.filters).map(([k,v])=>`${k}: ${v}`).join(' · ')}</small><Button variant="primary" onClick={()=>{try{onApply(audienceOptionToDraft(option));}catch(e){setError((e as Error).message);}}}>Usar este público</Button></section>)}</div>}
 </div></Modal>;
}
