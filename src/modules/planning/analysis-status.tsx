"use client";
import {useEffect,useState} from 'react';
import {useLiveRefresh} from '@/client/use-live-refresh';
import Link from 'next/link';
import {usePlanning,useProspecting} from '@/client/workspace-provider';
import type {PlanningAnalysis} from '@/client/planning-client';
import {Badge,Button,Notice} from '@/components/ui/primitives';
import {jobStateLabels} from '@/modules/prospecting/job-history';
const active=['queued','running','waiting_provider','cancelling'];
export function usePlanningAnalysis(id:string|null){
 const client=usePlanning(),[data,setData]=useState<PlanningAnalysis|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let live=true;setData(null);setError('');
  if(id&&client)client.get(id).then(next=>{if(live)setData(next);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};
 },[client,id,revision]);
 useLiveRefresh(async signal=>{if(!client||!id)return;try{const next=await client.get(id);if(!signal.aborted){setData(next);setError('');}}catch(e){if(!signal.aborted)setError((e as Error).message);throw e;}},5000,!!client&&!!id,id);
 return {data,error,refresh:()=>setRevision(v=>v+1)};
}
export function AnalysisStatus({data,error,onRefresh}:{data:PlanningAnalysis|null;error?:string;onRefresh:()=>void}){
 const client=useProspecting(),[busy,setBusy]=useState(false),[actionError,setActionError]=useState('');
 async function cancel(){if(!client||!data)return;setBusy(true);try{await client.cancel(data.job.id);onRefresh();}catch(e){setActionError(e instanceof Error?e.message:'Falha ao cancelar.');}finally{setBusy(false);}}
 return <section className="stack" aria-live="polite">{(error||actionError)&&<p role="alert">{error||actionError}</p>}{data?<>
  <div className="row between wrap"><Badge>{jobStateLabels[data.job.state]}</Badge><Link href={'/executions/'+data.job.id}>Abrir histórico da análise →</Link></div>
  {data.job.state==='queued'&&<Notice>Análise na fila. O worker precisa estar em execução.</Notice>}
  {data.job.error&&<p role="alert">{data.job.error.message} ({data.job.error.code})</p>}
  {data.job.state==='needs_reconciliation'&&<Notice>Resposta incerta. Um administrador deve conferir a chamada no histórico antes de retomar.</Notice>}
  <div className="row wrap"><Button onClick={onRefresh}>Atualizar</Button>{active.includes(data.job.state)&&<Button disabled={busy||data.job.state==='cancelling'} onClick={cancel}>Cancelar análise</Button>}</div>
 </>:<p>Carregando análise…</p>}</section>;
}
