"use client";
import {useCallback,useEffect,useState} from 'react';
import {useProspecting,useWorkspaceRefresh} from '@/client/workspace-provider';
import {useLiveRefresh} from '@/client/use-live-refresh';
import type {JobView} from '@/domain/prospecting';
import type {QualificationOverview} from '@/domain/execution-overview';
import {Button} from '@/components/ui/primitives';
import {ExecutionShell,StageLine} from './execution-shell';
import {LotMap,LotLegend} from './lot-map';
// 20/11/2026: the end-user qualification screen — the run as a lot map, results in groups, batch approval.
const stages=[{key:'sites',label:'Sites lidos'},{key:'cnpj',label:'CNPJ conferido'},{key:'ai',label:'IA avaliando o perfil'},{key:'summary',label:'Resumos'}];
const skipReasons={edited:'foi editada depois da análise',moved:'mudou de lista',unavailable:'já não está disponível'};
const foundLabels={email:'e-mail',phone:'telefone',cnpj:'CNPJ',site:'site'};
const active=['queued','running','waiting_provider','cancelling'];
const plural=(n:number,one:string,many:string)=>n===1?one:many;
function duration(from:string,to:string){const m=Math.max(1,Math.round((Date.parse(to)-Date.parse(from))/60000)),h=Math.floor(m/60);return h?`${h}h${String(m%60).padStart(2,'0')}`:`${m} min`;}
type Outcome={applied:number;skipped:{itemId:string;name:string;reason:keyof typeof skipReasons}[];what:[string,string]};
export function QualificationPanel({job,title,technicalHref,admin,onReconcile,actions}:{job:JobView;title:string;technicalHref:string|null;admin:boolean;onReconcile:()=>void;actions?:React.ReactNode}){
 const client=useProspecting()!,refreshWorkspace=useWorkspaceRefresh(),[o,setO]=useState<QualificationOverview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [review,setReview]=useState(false),[unchecked,setUnchecked]=useState<string[]>([]),[why,setWhy]=useState(false),[outcome,setOutcome]=useState<Outcome|null>(null);
 const running=active.includes(job.state);
 const load=useCallback(async()=>{try{const next=await client.overview(job.id);if(next.kind==='qualification')setO(next);setError('');}catch(e){setError(e instanceof Error?e.message:'Falha ao carregar.');}},[client,job.id]);
 useEffect(()=>{void load();},[load,job.revision,job.state]);
 useLiveRefresh(async()=>{await load();},5000,running,job.id);
 async function approve(ids:string[],what:[string,string],rejected:Record<string,string[]>={}){
  if(busy||!ids.length)return;setBusy(true);setError('');
  try{const r=await client.apply(job.id,ids,rejected,{skipConflicts:true});setOutcome({applied:r.applied,skipped:(r.skipped??[]) as Outcome['skipped'],what});setReview(false);setUnchecked([]);await load();await refreshWorkspace?.();}
  catch(e){setError(e instanceof Error?e.message:'Falha ao aprovar.');}finally{setBusy(false);}
 }
 if(!o)return <ExecutionShell title={title} status={error||'Carregando…'} technicalHref={technicalHref} actions={actions}><span/></ExecutionShell>;
 // The server applies only finished runs (completed or partial); a cancelled or failed run shows its results without buttons.
 const g=o.groups,readyIds=g.ready.itemIds.filter(id=>!unchecked.includes(id)),ended=!running,approvable=['completed','partial'].includes(job.state),fit=o.fitAssessed;
 const status=running?`Qualificando ${o.total} ${plural(o.total,'empresa','empresas')}`:job.state==='cancelled'?'Execução cancelada. O que foi analisado está abaixo.':`${o.done} ${plural(o.done,'empresa analisada','empresas analisadas')} em ${duration(job.createdAt,job.updatedAt)}`;
 const legend=[{group:'ready' as const,text:fit?`${g.ready.count} ${plural(g.ready.count,'pronta','prontas')}${running?' até agora':''}`:`${g.ready.count} com dados encontrados`},{group:'noInfo' as const,text:`${g.noInfo.count} sem informação`},{group:'outside' as const,text:`${g.outside.count} fora do perfil`},...(g.nothing.count?[{group:'nothing' as const,text:`${g.nothing.count} sem nada novo`}]:[])];
 return <ExecutionShell title={title} status={status} technicalHref={technicalHref} actions={actions}>
  {error&&<p role="alert" className="error-bar">{error}</p>}
  {job.state==='needs_reconciliation'&&<p className="execution-note" role="status">Uma etapa precisa ser conferida por um administrador. {admin&&<Button onClick={onReconcile}>Conferir agora</Button>}</p>}
  {job.error?.code==='WAITING_CAPACITY'&&<p className="execution-note" role="status">Aguardando vez para continuar.</p>}
  {job.state==='partial'&&<p className="execution-note" role="status">Parte das empresas não foi analisada.</p>}
  {running&&<><p className="execution-count"><b>{o.done} de {o.total}</b>{o.etaMinutes!==null&&<span>faltam cerca de {o.etaMinutes} {plural(o.etaMinutes,'minuto','minutos')}</span>}</p><StageLine stages={stages} current={o.stage}/></>}
  <LotMap dots={o.dots} label={`${o.done} de ${o.total} empresas analisadas: ${legend.map(l=>l.text).join(', ')}`}/>
  <LotLegend items={legend}/>
  {running&&<p className="execution-status">Pode fechar esta tela. O resultado fica em Execuções.</p>}
  {outcome&&<div className="execution-outcome" role="status"><p><b>{outcome.applied} {plural(outcome.applied,outcome.what[0],outcome.what[1])}</b>{outcome.skipped.length>0&&<>, {outcome.skipped.length} {plural(outcome.skipped.length,'ficou de fora','ficaram de fora')}</>}.</p>
   {outcome.skipped.length>0&&<ul>{outcome.skipped.map(s=><li key={s.itemId}>{s.name||'Empresa'}: {skipReasons[s.reason]}</li>)}</ul>}</div>}
  {ended&&<>
   {g.ready.count>0?<div className="execution-ready">
    <div><h2>{g.ready.count} {fit?plural(g.ready.count,'empresa pronta para abordar','empresas prontas para abordar'):plural(g.ready.count,'empresa com dados encontrados','empresas com dados encontrados')}</h2><p>{fit?plural(g.ready.count,'Combina com o seu cliente ideal.','Combinam com o seu cliente ideal.'):'Dados achados para salvar nos leads.'}</p>
     <p className="execution-gets">{o.ready.emails>0&&<span><b>{o.ready.emails}</b> {plural(o.ready.emails,'e-mail','e-mails')}</span>}{o.ready.cnpjs>0&&<span><b>{o.ready.cnpjs}</b> {plural(o.ready.cnpjs,'CNPJ','CNPJs')}</span>}{o.ready.summaries>0&&<span><b>{o.ready.summaries}</b> {plural(o.ready.summaries,'resumo','resumos')} para a abordagem</span>}</p></div>
    {g.ready.itemIds.length>0&&approvable?<Button variant="primary" className="execution-cta" disabled={busy||!readyIds.length} onClick={()=>approve(readyIds,['aprovada','aprovadas'])}>{busy?'Aprovando…':`Aprovar ${readyIds.length===1?'a':'as'} ${readyIds.length}`}</Button>:g.ready.applied>0&&!g.ready.itemIds.length?<span className="execution-status">{plural(g.ready.applied,'Já aprovada.','Já aprovadas.')}</span>:null}
    {g.ready.itemIds.length>0&&approvable&&<button type="button" className="execution-link" aria-expanded={review} onClick={()=>setReview(!review)}>{review?'Esconder a lista':'Conferir a lista antes'}</button>}
   </div>:<p className="execution-status">{fit?'Nenhuma empresa ficou pronta para abordar.':'Nenhum dado novo foi encontrado.'}</p>}
   {review&&<ul className="execution-list">{g.ready.itemIds.map(id=>{const it=o.items[id],on=!unchecked.includes(id);return <li key={id}><label><input type="checkbox" checked={on} onChange={()=>setUnchecked(on?[...unchecked,id]:unchecked.filter(x=>x!==id))}/><span className="execution-name">{it.name}{it.found.map(f=><span key={f} className="execution-tag">{foundLabels[f]}</span>)}</span></label><span className="execution-why">{it.brief??''}</span></li>;})}</ul>}
   <div className="execution-rest">
    {g.noInfo.count>0&&<div><div><b>{g.noInfo.count}</b> sem informação suficiente<p>{o.noInfo.contacts?`Os contatos achados em ${o.noInfo.contacts} ${plural(o.noInfo.contacts,'empresa','empresas')} já podem ser salvos.`:g.noInfo.applied?'Os contatos achados já foram salvos.':'Nenhum contato novo foi achado para elas.'}</p></div>
     {g.noInfo.itemIds.length>0&&approvable&&<button type="button" className="execution-link" disabled={busy} onClick={()=>approve(g.noInfo.itemIds,['com contatos salvos','com contatos salvos'],Object.fromEntries(g.noInfo.itemIds.map(id=>[id,['qualification','reason']])))}>Salvar os contatos</button>}</div>}
    {g.outside.count>0&&<div><div><b>{g.outside.count}</b> fora do perfil<p>{g.outside.count===1&&g.outside.itemIds[0]?o.items[g.outside.itemIds[0]].brief??'Não combinam com o seu cliente ideal.':'Não combinam com o seu cliente ideal.'}</p></div>
     <button type="button" className="execution-link" aria-expanded={why} onClick={()=>setWhy(!why)}>{why?'Esconder':'Ver por quê'}</button></div>}
    {why&&<div className="execution-why-list">{g.outside.itemIds.map(id=><p key={id}><b>{o.items[id].name}</b> {o.items[id].reason??''}</p>)}{g.outside.itemIds.length>0&&approvable&&<Button disabled={busy} onClick={()=>approve(g.outside.itemIds,['marcada como fora do perfil','marcadas como fora do perfil'])}>Marcar como fora do perfil</Button>}</div>}
    {g.nothing.count>0&&<p className="execution-status">{g.nothing.count} {plural(g.nothing.count,'empresa sem nada a aplicar','empresas sem nada a aplicar')}.</p>}
   </div>
  </>}
 </ExecutionShell>;
}
