"use client";
import {Fragment,useLayoutEffect,useRef,useState} from 'react';
import type {MessageState,MessageView} from '@/domain/whatsapp';
import {Button} from '@/components/ui/primitives';
import {Icon} from '@/components/ui/icon';
import {dayLabel,nearBottom,nextScrollTop} from '@/client/whatsapp-thread';
import {DeliveryDetails} from './delivery-details';
export const stateNames:Record<MessageState,string>={received:'Recebida',pending:'Na fila',dispatching:'Tentativa em andamento',accepted:'Aceita pelo provedor',delivered:'Entregue',read:'Lida',failed:'Falhou',uncertain:'Resultado incerto',cancelled:'Cancelada',blocked:'Bloqueada'};
const stateIcons:Partial<Record<MessageState,string>>={pending:'Clock',dispatching:'Clock',accepted:'Check',delivered:'CheckCheck',read:'CheckCheck',failed:'AlertCircle',uncertain:'AlertCircle',cancelled:'X',blocked:'AlertCircle'};
const alertStates:MessageState[]=['failed','uncertain','cancelled','blocked'];
const time=(iso:string)=>new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
// The conversation opens at the newest message; scrolling to the top fetches the previous page without moving what the person is reading.
export function WhatsappHistory({messages,hasOlder,onOlder,onReconcile}:{messages:MessageView[];hasOlder:boolean;onOlder:()=>Promise<void>;onReconcile?:(id:string)=>void}){
 const ref=useRef<HTMLDivElement>(null),stick=useRef(true),prev=useRef({height:0,first:''}),loading=useRef(false),[olderBusy,setOlderBusy]=useState(false),[olderError,setOlderError]=useState(''),[away,setAway]=useState(false);
 useLayoutEffect(()=>{
  const el=ref.current;if(!el)return;const first=messages[0]?.id??'';
  el.scrollTop=nextScrollTop({scrollHeight:el.scrollHeight,scrollTop:el.scrollTop,prevHeight:prev.current.height,prepended:!!prev.current.first&&first!==prev.current.first,stick:stick.current});
  prev.current={height:el.scrollHeight,first};
 },[messages]);
 // Panels below load after the history and shrink it; while reading the newest message, stay on it.
 useLayoutEffect(()=>{
  const el=ref.current;if(!el||typeof ResizeObserver==='undefined')return;
  const keep=new ResizeObserver(()=>{if(stick.current)el.scrollTop=el.scrollHeight;});keep.observe(el);return()=>keep.disconnect();
 },[]);
 async function older(){
  if(loading.current||!hasOlder)return;loading.current=true;setOlderBusy(true);setOlderError('');
  try{await onOlder();}catch(e){setOlderError(e instanceof Error?e.message:'Não foi possível carregar as mensagens anteriores.');}finally{loading.current=false;setOlderBusy(false);}
 }
 function scrolled(){const el=ref.current;if(!el)return;stick.current=nearBottom(el);setAway(!stick.current);if(el.scrollTop<120&&hasOlder&&!olderError)void older();}
 function toBottom(){const el=ref.current;if(!el)return;stick.current=true;setAway(false);el.scrollTop=el.scrollHeight;}
 return <div className="whatsapp-history-frame"><div ref={ref} className="whatsapp-history" aria-label="Histórico da conversa" onScroll={scrolled}>
  {hasOlder&&<div className="whatsapp-older">{olderBusy?<small role="status">Carregando mensagens anteriores…</small>:<Button onClick={()=>void older()}>Carregar mensagens anteriores</Button>}{olderError&&<small role="alert">{olderError}</small>}</div>}
  {!messages.length&&<p className="thread-empty">Nenhuma mensagem nesta conversa ainda.</p>}
  {messages.map((m,i)=>{const day=dayLabel(m.createdAt),showDay=i===0||dayLabel(messages[i-1].createdAt)!==day,icon=m.direction==='outbound'?stateIcons[m.state]:undefined;
   return <Fragment key={m.id}>{showDay&&<div className="whatsapp-day"><span>{day}</span></div>}
   <article className={`whatsapp-message ${m.direction}${alertStates.includes(m.state)?' alert':''}`}>
    <p>{m.text??(m.mediaKind?'Mídia recebida · '+m.mediaKind:'Mensagem sem texto')}</p>{m.mediaKind&&m.text&&<small>Mídia: {m.mediaKind}</small>}
    <footer className="whatsapp-meta"><time dateTime={m.createdAt} title={new Date(m.createdAt).toLocaleString('pt-BR')}>{time(m.createdAt)}</time>{icon&&<span className={`whatsapp-state ${m.state}`} role="img" aria-label={stateNames[m.state]} title={stateNames[m.state]}><Icon name={icon} size={14}/></span>}</footer>
    {alertStates.includes(m.state)&&<small className="whatsapp-state-alert">{stateNames[m.state]}</small>}
    <DeliveryDetails evidence={m.delivery} remoteId={m.remoteId}/>
    {m.state==='uncertain'&&<><small>O provedor pode ter recebido a mensagem. Não há repetição automática.</small>{onReconcile&&<Button onClick={()=>onReconcile(m.id)}>Reconciliar com evidência</Button>}</>}
    {m.state==='dispatching'&&<small>Uma tentativa em andamento não pode ser recolhida.</small>}
   </article></Fragment>;})}
 </div>{away&&<button type="button" className="whatsapp-to-bottom" aria-label="Ir para as mensagens mais recentes" title="Ir para as mensagens mais recentes" onClick={toBottom}><Icon name="ChevronDown" size={18}/></button>}</div>;
}
