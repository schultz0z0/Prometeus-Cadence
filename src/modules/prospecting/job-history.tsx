"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useProspecting} from '@/client/workspace-provider';
import {useDemo} from '@/demo/provider';
import type {JobView} from '@/domain/prospecting';
import {Button,PageHeader,Badge,EmptyState,LinkButton} from '@/components/ui/primitives';
export const jobStateLabels:Record<string,string>={queued:'Na fila',running:'Processando',waiting_provider:'Aguardando provedor',needs_reconciliation:'Reconciliar chamada',cancelling:'Cancelando',cancelled:'Cancelada',completed:'Concluída',partial:'Resultado parcial',failed:'Falhou'};
export function JobHistory(){
  const client=useProspecting()!,demo=useDemo(),[jobs,setJobs]=useState<JobView[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let active=true;client.list().then(page=>{if(active){setJobs(page.items);setCursor(page.nextCursor);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[client]);
  async function load(more=false){setBusy(true);setError('');try{const page=await client.list(more?cursor??undefined:undefined);setJobs(old=>more?[...old,...page.items.filter(j=>!old.some(o=>o.id===j.id))]:page.items);setCursor(page.nextCursor);}catch(e){setError(e instanceof Error?e.message:'Falha ao carregar.');}finally{setBusy(false);}}
  return <><PageHeader title="Execuções" description="Buscas e qualificações persistentes do seu workspace." actions={<Button onClick={()=>load()} disabled={busy} icon="RefreshCw">Atualizar</Button>}/>{error&&<p className="error-bar" role="alert">{error}</p>}
    <section className="panel">{jobs.length?<div className="table-scroll"><table className="data-table"><thead><tr><th>EXECUÇÃO</th><th>ESTADO</th><th>RESULTADOS</th><th>DATA</th><th/></tr></thead><tbody>{jobs.map(job=><tr key={job.id}><td><Link href={'/executions/'+job.id}>{job.kind==='generation'?'Busca de empresas':'Qualificação'} · {job.source}</Link><small>{job.id.slice(0,8)}</small></td><td><Badge tone={job.state==='completed'?'green':job.state==='failed'?'red':'neutral'}>{jobStateLabels[job.state]}</Badge></td><td>{job.counts.inserted} novos · {job.counts.duplicates} duplicados · {job.counts.pending} para revisão</td><td>{new Date(job.createdAt).toLocaleString('pt-BR')}</td><td><Link href={'/executions/'+job.id}>Ver detalhes →</Link></td></tr>)}</tbody></table></div>:<EmptyState title={busy?'Carregando execuções…':'Nenhuma execução real'} description="Prepare uma busca ou qualificação. Ela só entra na fila depois da sua confirmação."><LinkButton href="/leads/generator">Gerar leads</LinkButton></EmptyState>}</section>
    {cursor&&<div className="form-actions"><Button disabled={busy} onClick={()=>load(true)}>Carregar mais</Button></div>}
    {demo.jobs.length>0&&<details className="panel panel-pad section-gap"><summary>Histórico demonstrativo legado · {demo.jobs.length} entradas</summary>{demo.jobs.map(j=><p key={j.id}>{j.name} · demonstração · {j.count} exemplos</p>)}</details>}
  </>;
}
