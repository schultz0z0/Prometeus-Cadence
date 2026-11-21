"use client";
import {useCallback,useEffect,useState} from 'react';
import {useProspecting} from '@/client/workspace-provider';
import {useLiveRefresh} from '@/client/use-live-refresh';
import type {JobView} from '@/domain/prospecting';
import type {GenerationOverview} from '@/domain/execution-overview';
import {ExecutionShell,StageLine} from './execution-shell';
import {LotMap,LotLegend} from './lot-map';
// 21/11/2026: the end-user generation screen — companies come into the list on their own; the next step is to qualify them.
const sources:Record<GenerationOverview['source'],string>={MAPS:'Google Maps',WEB:'busca na web',CNPJ:'base CNPJ',APOLLO:'Apollo'};
const stagesFor=(s:GenerationOverview['source'])=>s==='CNPJ'?[{key:'search',label:'Buscando na base CNPJ'},{key:'maps',label:'Confirmando no Google Maps'},{key:'site',label:'Conferindo o site'},{key:'save',label:'Salvando na lista'}]
 :s==='WEB'?[{key:'search',label:'Buscando na web'},{key:'site',label:'Conferindo os sites'},{key:'save',label:'Salvando na lista'}]
 :[{key:'search',label:'Buscando no '+sources[s]},{key:'save',label:'Conferindo repetidas e salvando na lista'}];
const foundLabels={phone:'telefone',site:'site',email:'e-mail',cnpj:'CNPJ',rating:'nota no Google'};
const active=['queued','running','waiting_provider','cancelling'];
const plural=(n:number,one:string,many:string)=>n===1?one:many;
function duration(from:string,to:string){const m=Math.max(1,Math.round((Date.parse(to)-Date.parse(from))/60000)),h=Math.floor(m/60);return h?`${h}h${String(m%60).padStart(2,'0')}`:`${m} min`;}
export function GenerationPanel({job,technicalHref,actions}:{job:JobView;technicalHref:string|null;actions?:React.ReactNode}){
 const client=useProspecting()!,[o,setO]=useState<GenerationOverview|null>(null),[error,setError]=useState(''),[open,setOpen]=useState<''|'new'|'dup'|'out'>('');
 const running=active.includes(job.state);
 const load=useCallback(async()=>{try{const next=await client.overview(job.id);if(next.kind==='generation')setO(next);setError('');}catch(e){setError(e instanceof Error?e.message:'Falha ao carregar.');}},[client,job.id]);
 useEffect(()=>{void load();},[load,job.revision,job.state]);
 useLiveRefresh(async()=>{await load();},5000,running,job.id);
 const title=o?.listName??'Busca de empresas';
 if(!o)return <ExecutionShell title={title} status={error||'Carregando…'} technicalHref={technicalHref} actions={actions}><span/></ExecutionShell>;
 const source=sources[o.source],c=o.created,list=o.listName?`na lista ${o.listName}`:'na lista';
 const status=running?`Buscando ${o.target} ${plural(o.target,'empresa','empresas')} no ${source}`:job.state==='cancelled'?'Busca cancelada. O que já entrou na lista está abaixo.':`${o.examined} ${plural(o.examined,'empresa examinada','empresas examinadas')} em ${duration(job.createdAt,job.updatedAt)}, no ${source}`;
 const legend=[{group:'new' as const,text:`${c.count} ${plural(c.count,'nova','novas')}${running?' até agora':''}`},{group:'dup' as const,text:`${o.duplicates.count} já na sua base`},{group:'out' as const,text:`${o.discarded.count} ${plural(o.discarded.count,'descartada','descartadas')}`}];
 const gets=[[c.phones,'telefone','telefones'],[c.sites,'site','sites'],[c.ratings,'com nota no Google','com nota no Google'],[c.emails,'e-mail','e-mails'],[c.cnpjs,'CNPJ','CNPJs']] as const;
 const toggle=(k:'new'|'dup'|'out')=>setOpen(open===k?'':k);
 return <ExecutionShell title={title} status={status} technicalHref={technicalHref} actions={actions}>
  {error&&<p role="alert" className="error-bar">{error}</p>}
  {job.state==='failed'&&<p className="execution-note" role="status">A busca parou antes de terminar.</p>}
  {job.state==='needs_reconciliation'&&<p className="execution-note" role="status">Uma etapa precisa ser conferida por um administrador.</p>}
  {job.error?.code==='WAITING_CAPACITY'&&<p className="execution-note" role="status">Aguardando vez para continuar.</p>}
  {running&&<><p className="execution-count"><b>{o.progress} de {o.target}</b>{o.etaMinutes!==null&&<span>faltam cerca de {o.etaMinutes} {plural(o.etaMinutes,'minuto','minutos')}</span>}</p><StageLine stages={stagesFor(o.source)} current={o.stage==='maps'&&o.source!=='CNPJ'?'save':o.stage}/></>}
  <LotMap dots={o.dots} label={`${o.examined} ${plural(o.examined,'empresa examinada','empresas examinadas')}: ${legend.map(l=>l.text).join(', ')}`}/>
  <LotLegend items={legend}/>
  {running&&<p className="execution-status">Pode fechar esta tela. As empresas já entram na lista enquanto a busca anda.</p>}
  {!running&&(c.count>0?<div className="execution-ready">
   <div><h2>{c.count} {plural(c.count,'empresa nova','empresas novas')} {list}</h2><p>Ainda sem qualificação.</p>
    <p className="execution-gets">{gets.filter(([n])=>n>0).map(([n,one,many])=><span key={one}><b>{n}</b> {plural(n,one,many)}</span>)}</p></div>
   {o.listId&&<a className="btn primary execution-cta" href={'/leads/qualifier?lista='+encodeURIComponent(o.listId)} onClick={()=>{try{sessionStorage.setItem('qualificar:'+o.listId,JSON.stringify(c.companies.map(x=>x.leadId)));}catch{}}}>{`Qualificar ${c.count===1?'a':'as'} ${c.count}`}</a>}
   <p className="execution-links"><button type="button" className="execution-link" aria-expanded={open==='new'} onClick={()=>toggle('new')}>{open==='new'?'Esconder as empresas':'Ver as empresas'}</button>{o.listId&&<a className="execution-link" href={'/contacts?list='+encodeURIComponent(o.listId)}>Abrir a lista</a>}</p>
  </div>:<p className="execution-status">Nenhuma empresa nova entrou na lista.</p>)}
  {open==='new'&&<ul className="execution-list">{c.companies.map(x=><li key={x.leadId}><span className="execution-name">{x.leadId?<a href={'/leads/'+encodeURIComponent(x.leadId)}>{x.name}</a>:x.name}{x.found.map(f=><span key={f} className="execution-tag">{foundLabels[f]}</span>)}</span><span className="execution-why">{x.city??''}</span></li>)}</ul>}
  {!running&&(o.duplicates.count>0||o.discarded.count>0)&&<div className="execution-rest">
   {o.duplicates.count>0&&<div><div><b>{o.duplicates.count}</b> {plural(o.duplicates.count,'já estava na sua base','já estavam na sua base')}<p>Não foram repetidas; continuam onde estavam.</p></div>
    <button type="button" className="execution-link" aria-expanded={open==='dup'} onClick={()=>toggle('dup')}>{open==='dup'?'Esconder':'Ver quais'}</button></div>}
   {open==='dup'&&<div className="execution-why-list">{o.duplicates.names.map((n,i)=><p key={i}>{n}</p>)}</div>}
   {o.discarded.count>0&&<div><div><b>{o.discarded.count}</b> {plural(o.discarded.count,'descartada','descartadas')}<p>Não eram site de empresa ou não deu para confirmar a empresa.</p></div>
    {o.discarded.reasons.length>0&&<button type="button" className="execution-link" aria-expanded={open==='out'} onClick={()=>toggle('out')}>{open==='out'?'Esconder':'Ver motivos'}</button>}</div>}
   {open==='out'&&<div className="execution-why-list">{o.discarded.reasons.map(r=><p key={r.label}><b>{r.count}</b> {r.label}</p>)}</div>}
  </div>}
 </ExecutionShell>;
}
