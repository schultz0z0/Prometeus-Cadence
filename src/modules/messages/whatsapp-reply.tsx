"use client";
import {useRef,useState} from 'react';
import type {MessagingClient,ReplyReview} from '@/client/messaging-client';
import type {OutboundContent,PreparedSend,TemplateView} from '@/domain/whatsapp';
import {Button,Modal,Notice} from '@/components/ui/primitives';
import {WhatsappContentField} from '@/modules/settings/whatsapp-content-field';
import {useMessagingReview} from './use-messaging-review';
import type {WhatsappCapabilities} from '@/domain/whatsapp-capabilities';
import {whatsappBlocker} from '@/client/whatsapp-copy';
export function WhatsappReply({conversationId,client,templates,onQueued,capabilities}:{conversationId:string;client:MessagingClient;templates:TemplateView[];onQueued:()=>Promise<void>;capabilities?:WhatsappCapabilities}){
 const [content,setContent]=useState<OutboundContent>({kind:'text',text:''}),[prepared,setPrepared]=useState<ReplyReview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),pending=useRef(false);
 const fingerprint=JSON.stringify({conversationId,content}),{flow,state}=useMessagingReview<PreparedSend>(fingerprint);
 async function act(fn:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Não foi possível concluir.');}finally{pending.current=false;setBusy(false);}}
 function edit(v:OutboundContent){flow.reset();setPrepared(null);setContent(v);setMessage('');}
 return <section className="reply-composer stack"><h3>Responder por WhatsApp</h3><Notice>{capabilities?.requiresServiceWindow===false?'Número próprio OpenWA: responda em texto e respeite a autorização do contato, as cotas e o risco de bloqueio.':'Texto livre exige uma mensagem recebida nas últimas 24 horas. Fora dessa janela, selecione um template aprovado e verifique o consentimento da finalidade.'}</Notice><fieldset disabled={busy} className="channel-fields"><legend>Rascunho desta conversa</legend><WhatsappContentField capabilities={capabilities} content={content} templates={templates} onChange={edit}/></fieldset>
 <div><Button variant="primary" disabled={busy||(content.kind==='text'&&!content.text.trim())} onClick={()=>act(async()=>{flow.edit(fingerprint);const ticket=flow.begin(),p=await client.prepareReply(conversationId,{content});if(flow.accept(ticket,p.review))setPrepared(p);})}>{busy?'Preparando…':'Revisar resposta'}</Button></div>{message&&<p role="status">{message}</p>}{error&&<p role="alert" className="error-bar">{error}</p>}
 {prepared&&(state.kind==='reviewing'||state.kind==='blocked'||state.kind==='confirming')&&<Modal title="Revisar resposta antes de enviar" onClose={()=>{if(!busy){flow.reset();setPrepared(null);}}}><div className="stack"><p>Para: {prepared.review.snapshot.identity.phone??prepared.review.snapshot.identity.externalId}</p><div className="message-preview">{prepared.review.preview}</div>{prepared.review.blockers.map(b=><p role="alert" key={b}>{whatsappBlocker(b)}</p>)}<Notice>Confirmar adiciona à fila. O provedor ainda precisa aceitar a mensagem e confirmar a entrega.</Notice>{error&&<p role="alert">{error}</p>}<div className="form-actions"><Button disabled={busy} onClick={()=>{flow.reset();setPrepared(null);}}>Voltar</Button><Button variant="primary" disabled={busy||!!prepared.review.blockers.length} onClick={()=>act(async()=>{if(!flow.confirm())return;try{await client.confirmReply(prepared);flow.reset();setPrepared(null);setContent({kind:'text',text:''});setMessage('Resposta adicionada à fila. Atualize o histórico para acompanhar o resultado.');await onQueued();}catch(e){flow.accept(flow.begin(),prepared.review);throw e;}})}>Confirmar e colocar na fila</Button></div></div></Modal>}
 </section>;
}
