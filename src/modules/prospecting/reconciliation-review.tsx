"use client";
import {useState} from 'react';
import {useProspecting} from '@/client/workspace-provider';
import type {JobView} from '@/domain/prospecting';
import {Button,Modal,Field,Notice} from '@/components/ui/primitives';
export function ReconciliationReview({job,onClose,onDone}:{job:JobView;onClose:()=>void;onDone:()=>void}){
  const client=useProspecting()!,attempts=job.unresolvedAttempts??[];
  const [operationId,setOperationId]=useState(attempts[0]?.id??''),[action,setAction]=useState(''),[runId,setRunId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const attempt=attempts.find(a=>a.id===operationId);
  async function confirm(){if(busy||!attempt)return;setBusy(true);setError('');try{
    await client.reconcile(job.id,{operationId,...(action==='run'?{runId:runId.trim()}:action==='notStarted'?{confirmNotStarted:true as const}:{resultUnavailable:true as const})});onDone();
  }catch(e){setError(e instanceof Error?e.message:'Falha ao reconciliar.');}finally{setBusy(false);}}
  return <Modal title="Reconciliar chamada externa" onClose={()=>{if(!busy)onClose();}}><div className="stack"><Notice>Confira a chamada diretamente no provedor. A resolução vale somente para a operação selecionada. O sistema não verifica ausência nem estorno por você.</Notice>
    {!attempts.length?<p role="alert">Não há chamada incerta identificada. Atualize a execução e revise o histórico.</p>:<>
      <Field label="Chamada incerta"><select value={operationId} disabled={busy} onChange={e=>{setOperationId(e.target.value);setAction('');}}>{attempts.map(a=><option key={a.id} value={a.id}>{a.provider} · {a.step}</option>)}</select></Field>
      <Field label="Resultado da conferência"><select value={action} disabled={busy} onChange={e=>setAction(e.target.value)}><option value="">Selecione uma resolução</option>{attempt?.canAttachRun&&<option value="run">Existe um run Apify: vincular e retomar</option>}<option value="notStarted">Confirmei que a chamada não foi iniciada</option><option value="unavailable">A chamada ocorreu, mas o resultado está indisponível</option></select></Field>
      {action==='run'&&<Field label="ID do run Apify"><input value={runId} disabled={busy} onChange={e=>setRunId(e.target.value)} placeholder="ID fornecido pelo Apify"/></Field>}
      {action==='notStarted'&&<Notice>Esta confirmação autoriza uma nova tentativa. Confirme a ausência no provedor para evitar cobrança duplicada.</Notice>}
      {action==='unavailable'&&<Notice>O consumo reservado desta chamada será registrado com custo monetário desconhecido. O módulo será marcado sem resultado e a chamada não será repetida. Se houver run em andamento, confira e encerre-o no provedor.</Notice>}
    </>}{error&&<p className="error-bar" role="alert">{error}</p>}<div className="form-actions"><Button disabled={busy} onClick={onClose}>Voltar</Button><Button variant="primary" disabled={busy||!attempt||!action||(action==='run'&&!runId.trim())} onClick={confirm}>{busy?'Reconciliando…':'Confirmar reconciliação'}</Button></div></div></Modal>;
}
