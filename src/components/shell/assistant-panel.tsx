"use client";
import Link from 'next/link';
import {useEffect,useRef} from 'react';
import {Icon} from '../ui/icon';
import {IconButton} from '../ui/primitives';
export function AssistantPanel({onClose}:{onClose:()=>void}){
 const panel=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const trigger=document.activeElement as HTMLElement|null;
  panel.current?.show();panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose();}};
  document.addEventListener('keydown',escape);
  return ()=>{document.removeEventListener('keydown',escape);panel.current?.close();trigger?.focus();};
 },[onClose]);
 return <dialog className="assistant-panel" ref={panel} aria-labelledby="assistant-title" aria-describedby="assistant-availability">
  <header><span className="assistant-avatar"><Icon name="Sparkles" size={20}/></span><div><h3 id="assistant-title">Assistente Prometeus</h3><p>Tire suas dúvidas sobre a plataforma</p></div><IconButton icon="X" label="Fechar assistente" onClick={onClose}/></header>
  <div className="assistant-content"><span className="assistant-welcome-icon"><Icon name="Bot" size={24}/></span><h4>Como posso ajudar?</h4><p>Consulte seu plano, conecte seus canais ou use os assistentes das áreas para preparar propostas com revisão.</p><nav aria-label="Atalhos do assistente">{[
   ['/cadences','Por que minha cadência não saiu hoje?'],['/settings/plan','Quais são os limites do meu plano?'],['/settings/email','Como conecto meu Gmail?'],['/settings/whatsapp','Como conectar o WhatsApp?'],['/contacts','Como importar uma planilha?'],
  ].map(([href,label])=><Link key={href} href={href} onClick={onClose}>{label}</Link>)}</nav><p id="assistant-availability" className="assistant-availability">O chat sobre a conta será disponibilizado no marco 06F. Por enquanto, os atalhos abrem as áreas reais do aplicativo.</p></div>
  <footer><div className="assistant-composer"><textarea rows={1} placeholder="Faça sua pergunta..." aria-label="Faça sua pergunta" disabled/><button type="button" aria-label="Enviar" disabled><Icon name="Send" size={17}/></button></div><p>Assistentes de IA disponíveis nas áreas de prospecção e cadências</p><div><Link href="/first-steps" onClick={onClose}>Primeiros passos</Link><Link href="/settings/context" onClick={onClose}>Contexto de IA</Link></div></footer>
 </dialog>;
}
