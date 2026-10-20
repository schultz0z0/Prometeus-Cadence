"use client";
import {useEffect,useState} from 'react';
import {useProspecting} from '@/client/workspace-provider';
import type {JobItemView,JobView} from '@/domain/prospecting';
import {Button,Badge} from '@/components/ui/primitives';
import {QualificationReview} from './qualification-review';
const fields:Record<string,string>={email:'E-mail',phone:'Telefone',site:'Site',city:'Cidade',state:'Estado',cnpj:'CNPJ',companyName:'Razão social',summary:'Resumo',qualification:'Qualificação',reason:'Parecer'};
const format=(value:unknown)=>value===null||value===undefined||value===''?'Não preenchido':String(value);
export function JobResults({job}:{job:JobView}){
  const client=useProspecting()!,[items,setItems]=useState<JobItemView[]>([]),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<string[]>([]),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[success,setSuccess]=useState(''),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;client.items(job.id).then(page=>{if(active){setItems(page.items);setCursor(page.nextCursor);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[client,job.id,job.revision,refresh]);
  async function more(){setBusy(true);try{const page=await client.items(job.id,cursor??undefined);setItems(old=>[...old,...page.items]);setCursor(page.nextCursor);}catch(e){setError(e instanceof Error?e.message:'Falha ao carregar.');}finally{setBusy(false);}}
  const applicable=job.kind==='qualification'&&['completed','partial'].includes(job.state);
  return <section className="stack section-gap" aria-label="Resultados da execução"><div className="row between wrap"><h2>Resultados</h2>{applicable&&<Button variant="primary" disabled={!selected.length} onClick={()=>setConfirm(true)}>Revisar aplicação · {selected.length}</Button>}</div>{error&&<p role="alert" className="error-bar">{error}</p>}{success&&<p role="status" className="notice success">{success}</p>}
    {!items.length&&<p className="muted">Os resultados aparecerão aqui depois do processamento.</p>}
    {items.map(item=>{const proposals=item.results.filter(r=>r.status==='pending_review').flatMap(r=>Object.entries(r.proposed).map(([key,value])=>({key,value,base:(r.base as Record<string,unknown>)[key]})));return <article className="panel panel-pad" key={item.id}><div className="row between wrap"><label className="row">{applicable&&!item.applied&&proposals.length>0&&<input type="checkbox" aria-label={'Selecionar '+item.name} checked={selected.includes(item.id)} onChange={e=>setSelected(e.target.checked?[...selected,item.id]:selected.filter(id=>id!==item.id))}/>}<strong>{item.name}</strong></label><Badge tone={item.applied?'green':'neutral'}>{item.applied?'Aplicado':item.status==='inserted'?'Inserido':item.status==='duplicate'?'Duplicado':'Para revisão'}</Badge></div>
      {proposals.length>0&&<div className="table-scroll section-gap"><table className="data-table"><thead><tr><th>CAMPO</th><th>ANTERIOR</th><th>PROPOSTO</th></tr></thead><tbody>{proposals.map((p,i)=><tr key={p.key+i}><td>{fields[p.key]??p.key}</td><td>{format(p.base)}</td><td className="proposal-value">{format(p.value)}</td></tr>)}</tbody></table></div>}
      {item.results.map(r=><div className="section-gap" key={r.module}><small>{r.module} · {r.status}{r.reasons.length?' · '+r.reasons.join(' · '):''}</small>{r.decision&&<p className="secondary-text">Sugestão JEV: {r.decision.verdict} · confiança {r.decision.confidence===null?'ausente':r.decision.confidence.toFixed(3)}. Sem acurácia medida.</p>}</div>)}
      {(item.evidence??[]).length>0&&<details className="section-gap"><summary>Fontes coletadas</summary>{item.evidence!.map(e=><p key={e.id}><a href={e.url} target="_blank" rel="noreferrer">{e.url}</a><small> · {new Date(e.fetchedAt).toLocaleString('pt-BR')}{e.truncated?' · evidência truncada':''}</small></p>)}</details>}
    </article>;})}
    {cursor&&<Button disabled={busy} onClick={more}>Carregar mais resultados</Button>}
    {confirm&&<QualificationReview count={selected.length} onClose={()=>setConfirm(false)} onApply={async()=>{const result=await client.apply(job.id,selected);setSuccess(`${result.applied} contatos atualizados.`);setConfirm(false);setSelected([]);setRefresh(n=>n+1);}}/>}
  </section>;
}
