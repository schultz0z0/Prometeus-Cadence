"use client";
import {useState} from 'react';
import type {Review} from '@/domain/prospecting';
import {Button,Modal,Notice} from '@/components/ui/primitives';
const units:Record<string,string>={candidates:'candidatos',apifyRuns:'execuções Apify',apolloPages:'páginas Apollo',jevCalls:'decisões JEV',codexCalls:'chamadas Codex',openaiCalls:'chamadas OpenAI',geminiCalls:'chamadas Gemini'};
export function JobReview({review,onClose,onConfirm}:{review:Review;onClose:()=>void;onConfirm:()=>Promise<void>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function confirm(){if(busy)return;setBusy(true);setError('');try{await onConfirm();}catch(e){setError(e instanceof Error?e.message:'Não foi possível confirmar.');}finally{setBusy(false);}}
  return <Modal title="Revisar execução" onClose={()=>{if(!busy)onClose();}}>
    <div className="stack"><p>{review.input.kind==='generation'?`Buscar até ${review.input.limit} empresas pela fonte ${review.input.source}.`:`Processar ${review.input.leadIds.length} contatos nos módulos selecionados.`}</p>
      <Notice>Preparar esta revisão não criou lista nem iniciou uma chamada externa. A execução começa somente após confirmar.</Notice>
      {review.aiRoute&&<p>Rota: {review.aiRoute.effectiveMode==='hybrid'?'JEV decide; LLM convencional complementa':'LLM convencional decide e gera'} · {review.aiRoute.conventional.provider} · {review.aiRoute.conventional.model}.</p>}
      <div className="panel panel-pad"><h3>Reserva máxima de uso</h3>{review.usage.length?review.usage.map((u,i)=><p key={i}>{u.maxUnits} {units[u.unit]} · {u.estimatedUsd===null?'custo monetário ainda desconhecido':`estimativa US$ ${u.estimatedUsd}`}</p>):<p>Somente extração pública, sem unidade de IA reservada.</p>}</div>
      {review.warnings.map(w=><p className="secondary-text" key={w}>{w}</p>)}
      {review.blockers.length>0&&<div className="notice" role="alert"><div><strong>Antes de executar</strong>{review.blockers.map(b=><p key={b}>{b}</p>)}</div></div>}
      {error&&<p role="alert" className="error-bar">{error}</p>}
      <small>Revisão válida até {new Date(review.expiresAt).toLocaleTimeString('pt-BR')}. Alterações de contexto ou configuração exigem nova revisão.</small>
      <div className="form-actions"><Button disabled={busy} onClick={onClose}>Voltar</Button><Button variant="primary" disabled={busy||review.blockers.length>0} onClick={confirm}>{busy?'Confirmando…':'Confirmar execução'}</Button></div>
    </div>
  </Modal>;
}
