"use client";
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import {commandLabels,type AssistantMessage,type AssistantProposal,type AssistantView} from '@/domain/assistant-actions';
import {helpArticles} from '@/domain/help-manifest';
import {askAssistant,cancelProposal,confirmProposal,prepareProposal,readAssistant,type ProposalReview} from '@/client/assistant-client';
import {Icon} from '../ui/icon';
import {Button,IconButton} from '../ui/primitives';
import {units} from '@/modules/prospecting/job-review';
const suggestions=['Por que minha cadência não saiu hoje?','Quais são os limites do meu plano?','Como conecto meu Gmail?'];
const store={get:(k:string)=>{try{return sessionStorage.getItem(k)??'';}catch{return '';}},set:(k:string,v:string)=>{try{if(v)sessionStorage.setItem(k,v);else sessionStorage.removeItem(k);}catch{}}};
// A proposal only opens the existing review of its area; confirming never sends or activates anything.
function ProposalCard({proposal,workspaceId,onClose}:{proposal:AssistantProposal;workspaceId:string|null;onClose:()=>void}){
 const [p,setP]=useState(proposal),[review,setReview]=useState<ProposalReview['review']|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),requestId=useRef(crypto.randomUUID());
 const expired=p.state==='proposed'&&Date.parse(p.expiresAt)<=Date.now();
 async function act(fn:(signal:AbortSignal)=>Promise<void>){if(!workspaceId||busy)return;setBusy(true);setError('');try{await fn(new AbortController().signal);}catch(e){setError((e as Error).message);if((e as {status?:number}).status===409)setReview(null);}finally{setBusy(false);}}
 return <section className="assistant-proposal" aria-label={'Proposta: '+commandLabels[p.kind]}>
  <small>{commandLabels[p.kind]}</small><strong>{p.summary}</strong>
  {p.kind==='draft-reply'&&<blockquote>{String(p.payload.text)}</blockquote>}
  {p.state==='confirmed'?<div className="assistant-proposal-actions"><span className="assistant-proposal-done"><Icon name="CheckCircle2" size={13}/>Confirmada</span>{p.href&&(p.kind==='draft-reply'
   // A full navigation: the inbox reads the draft from the URL when it mounts, also when it is already open.
   ?<a href={p.href}>Abrir<Icon name="ArrowRight" size={12}/></a>
   :<Link href={p.href} onClick={onClose}>Abrir<Icon name="ArrowRight" size={12}/></Link>)}</div>
  :p.state==='cancelled'?<p className="assistant-proposal-note">Cancelada.</p>
  :expired?<p className="assistant-proposal-note">A proposta venceu. Peça de novo ao assistente.</p>
  :review?<>{review.warnings.map(w=><p key={w} className="assistant-proposal-note">{w}</p>)}{review.blockers.map(b=><p key={b} role="alert" className="assistant-proposal-blocker">{b}</p>)}
    {!!review.usage?.length&&<p className="assistant-proposal-note">Uso estimado: {review.usage.map(u=>`até ${u.maxUnits} ${units[u.unit]??u.unit}`).join(', ')}</p>}
    <div className="assistant-proposal-actions"><Button variant="compact" disabled={busy} onClick={()=>setReview(null)}>Voltar</Button><Button variant="primary compact" disabled={busy||review.blockers.length>0} onClick={()=>void act(async s=>{const r=await confirmProposal(workspaceId!,p.id,{token:review.token,requestId:requestId.current},s);setP(r.proposal);setReview(null);})}>{busy?'Confirmando…':'Confirmar'}</Button></div></>
  :<div className="assistant-proposal-actions"><Button variant="primary compact" disabled={busy||!workspaceId} onClick={()=>void act(async s=>{const r=await prepareProposal(workspaceId!,p.id,s);setP(r.proposal);setReview(r.review);})}>{busy?'Preparando…':'Revisar'}</Button><Button variant="compact" disabled={busy||!workspaceId} onClick={()=>void act(async s=>setP(await cancelProposal(workspaceId!,p.id,s)))}>Cancelar</Button></div>}
  {error&&<p role="alert" className="assistant-proposal-blocker">{error}</p>}
 </section>;
}
function Message({m,onClose,workspaceId}:{m:AssistantMessage;onClose:()=>void;workspaceId:string|null}){
 const links=m.citations.flatMap(c=>c.kind==='help'?helpArticles.filter(a=>a.id===c.id):[]);
 return <div className={'assistant-message '+m.role}>
  <p>{m.text}</p>
  {m.role==='assistant'&&(links.length>0||m.fallback)&&<footer>{m.fallback&&<small>Central de Ajuda</small>}{links.map(a=><Link key={a.id} href={a.href} onClick={onClose}>{a.title}<Icon name="ArrowRight" size={12}/></Link>)}</footer>}
 {m.proposal&&<ProposalCard proposal={m.proposal} workspaceId={workspaceId} onClose={onClose}/>}
 </div>;
}
export function AssistantPanel({onClose,onHelp,workspaceId}:{onClose:()=>void;onHelp:()=>void;workspaceId:string|null}){
 const panel=useRef<HTMLDialogElement>(null),log=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null),inflight=useRef<AbortController|null>(null);
 const path=usePathname(),draftKey='assistant-draft:'+(workspaceId??'demo');
 const [view,setView]=useState<AssistantView|null>(null),[loadError,setLoadError]=useState(''),[attempt,setAttempt]=useState(0);
 const [text,setText]=useState(()=>store.get(draftKey)),[pending,setPending]=useState<{text:string;requestId:string}|null>(null),[failed,setFailed]=useState<{text:string;requestId:string;message:string}|null>(null);
 const [todayOpen,setTodayOpen]=useState(true),[dismissed,setDismissed]=useState<string[]>(()=>store.get('assistant-dismissed:'+(workspaceId??'demo')).split(',').filter(Boolean));
 useEffect(()=>{
  const trigger=document.activeElement as HTMLElement|null,dialog=panel.current;
  dialog?.show();input.current?.focus();
  // A modal opened over the panel (search, help) owns Escape; one key press closes one layer.
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('dialog:modal')){event.preventDefault();onClose();}};
  document.addEventListener('keydown',escape);
  return ()=>{document.removeEventListener('keydown',escape);inflight.current?.abort();dialog?.close();trigger?.focus();};
 },[onClose]);
 useEffect(()=>{
  if(!workspaceId)return;const controller=new AbortController();setLoadError('');
  readAssistant(workspaceId,controller.signal).then(setView).catch(e=>{if(!controller.signal.aborted)setLoadError(e.message);});
  return ()=>controller.abort();
 },[workspaceId,attempt]);
 useEffect(()=>{store.set(draftKey,text);},[draftKey,text]);
 useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight});},[view?.messages.length,pending,failed]);
 async function send(question:string,requestId=crypto.randomUUID()){
  const value=question.trim();if(!value||!workspaceId||!view||pending)return;
  const controller=new AbortController();inflight.current=controller;
  setPending({text:value,requestId});setFailed(null);if(value===text.trim())setText('');
  try{
   const reply=await askAssistant(workspaceId,{...(view?.threadId?{threadId:view.threadId}:{}),text:value,contextRoute:path,requestId},controller.signal);
   setView(v=>v&&{...v,threadId:reply.threadId,messages:[...v.messages.filter(m=>m.requestId!==reply.question.requestId),reply.question,reply.message],remaining:reply.remaining});
  }catch(e){
   if(controller.signal.aborted)return;
   // The question stays available to retry with the same request id, so a lost response is never asked twice.
   setFailed({text:value,requestId,message:(e as Error).message});setText(t=>t||value);
  }finally{if(inflight.current===controller){inflight.current=null;setPending(null);}}
 }
 function dismiss(id:string){const next=[...dismissed,id];setDismissed(next);store.set('assistant-dismissed:'+(workspaceId??'demo'),next.join(','));}
 const today=(view?.today??[]).filter(t=>!dismissed.includes(t.id)),empty=!view?.messages.length&&!pending&&!failed,limited=view?.remaining===0,ready=!!view&&!limited;
 // A question whose answer never arrived (panel closed mid-answer) is offered again with its own request id.
 const last=view?.messages.at(-1),orphan=last?.role==='user'&&!pending&&!failed?last:null;
 return <dialog className="assistant-panel" ref={panel} aria-labelledby="assistant-title">
  <header><span className="assistant-avatar"><Icon name="Bot" size={18}/></span><div><h3 id="assistant-title">Assistente Prometeus</h3><p>Tire suas dúvidas sobre a plataforma</p></div>
   <IconButton icon="Plus" label="Nova conversa" onClick={()=>{setView(v=>v&&{...v,threadId:null,messages:[]});setFailed(null);input.current?.focus();}}/><IconButton icon="X" label="Fechar assistente" onClick={onClose}/></header>
  <div className="assistant-content" ref={log} aria-live="polite">
   {today.length>0&&<section className="assistant-today">
    <button type="button" aria-expanded={todayOpen} onClick={()=>setTodayOpen(o=>!o)}><Icon name="Lightbulb" size={13}/>PRA HOJE · {today.length}<Icon name={todayOpen?'ChevronUp':'ChevronDown'} size={14}/></button>
    {todayOpen&&today.map(t=><article key={t.id}><header><strong>{t.title}</strong><IconButton icon="X" label={'Dispensar: '+t.title} onClick={()=>dismiss(t.id)}/></header><p>{t.text}</p>
     <div><Link href={t.href} onClick={onClose}>{t.action}<Icon name="ArrowRight" size={12}/></Link><button type="button" onClick={()=>void send(t.question)} disabled={!!pending||!ready}>Perguntar</button></div></article>)}
   </section>}
   {empty&&<div className="assistant-welcome"><span className="assistant-welcome-icon"><Icon name="Bot" size={22}/></span><h4>Como posso ajudar?</h4>
    <p>Respondo com base na Central de Ajuda e nos dados da sua conta (plano, canais, cadências) e mostro onde resolver cada coisa.</p>
    {workspaceId&&<nav aria-label="Sugestões de pergunta">{suggestions.map(s=><button type="button" key={s} onClick={()=>void send(s)} disabled={!ready}>{s}</button>)}</nav>}</div>}
   {view?.messages.map(m=><Message key={m.id} m={m} onClose={onClose} workspaceId={workspaceId}/>)}
   {orphan&&<div className="assistant-message error" role="alert"><p>Esta pergunta ficou sem resposta.</p><button type="button" onClick={()=>void send(orphan.text,orphan.requestId)}>Tentar de novo</button></div>}
   {pending&&<>{!view?.messages.some(m=>m.requestId===pending.requestId)&&<div className="assistant-message user"><p>{pending.text}</p></div>}<div className="assistant-message assistant pending" role="status"><Icon name="LoaderCircle" size={14}/><p>Consultando a ajuda e a sua conta…</p></div></>}
   {failed&&<><div className="assistant-message user"><p>{failed.text}</p></div><div className="assistant-message error" role="alert"><p>{failed.message}</p><button type="button" onClick={()=>void send(failed.text,failed.requestId)}>Tentar de novo</button></div></>}
   {loadError&&<div className="assistant-message error" role="alert"><p>{loadError}</p><button type="button" onClick={()=>setAttempt(a=>a+1)}>Tentar de novo</button></div>}
  </div>
  <footer>
   <form className="assistant-composer" onSubmit={e=>{e.preventDefault();void send(text);}}>
    <textarea ref={input} rows={1} maxLength={2000} placeholder="Faça sua pergunta..." aria-label="Faça sua pergunta" value={text} disabled={!workspaceId||limited} onChange={e=>setText(e.target.value)}
     onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send(text);}}}/>
    <button type="submit" aria-label="Enviar" disabled={!ready||!text.trim()||!!pending}><Icon name="Send" size={16}/></button>
   </form>
   <p>{!workspaceId?'Entre na sua conta para conversar com o assistente.':limited?'Você usou as perguntas de hoje. A Central de Ajuda continua disponível.':view&&!view.aiAvailable?'A IA está indisponível agora; respondo pela Central de Ajuda.':'Com base na Central de Ajuda e na sua conta'}</p>
   <div><button type="button" onClick={onHelp}><Icon name="HelpCircle" size={11}/>Central de Ajuda</button><Link href="/first-steps" onClick={onClose}>Primeiros passos</Link><Link href="/settings/context" onClick={onClose}>Contexto de IA</Link></div>
  </footer>
 </dialog>;
}
