"use client";
import {useRef,useState} from 'react';
import type {MailClient,MailReplyPrepared} from '@/client/mail-client';
import type {MailboxView,MailSend} from '@/domain/mail';
import {mailBlocker} from '@/client/mail-copy';
import {Button,Field,Modal,Notice} from '@/components/ui/primitives';
import {useMessagingReview} from './use-messaging-review';
export function EmailReply({drafts,conversationId,client,mailbox,subject,disabled=false,onQueued}:{drafts?:Map<string,string>;conversationId:string;client:MailClient;mailbox:MailboxView;subject:string;disabled?:boolean;onQueued:()=>Promise<void>}){
 const [messageId,setMessageId]=useState(()=>crypto.randomUUID()),[text,setText]=useState(()=>drafts?.get(conversationId)??''),[prepared,setPrepared]=useState<MailReplyPrepared|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(''),pending=useRef(false);
 const replySubject=/^re:/i.test(subject)?subject:'Re: '+subject;
 const fingerprint=JSON.stringify({conversationId,messageId,text,replySubject,revision:mailbox.revision,signature:mailbox.signature}),{flow,state}=useMessagingReview<MailSend>(fingerprint);
 function reset(){flow.reset();setPrepared(null);}
 async function act(run:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await run();}catch(e){setError(e instanceof Error?e.message:'Não foi possível preparar a resposta.');}finally{pending.current=false;setBusy(false);}}
 const reviewing=prepared&&(state.kind==='reviewing'||state.kind==='blocked'||state.kind==='confirming');
 return <section className="reply-composer stack"><h3>Responder por e-mail</h3><Notice>A resposta mantém as referências desta thread. Confira o destinatário e a assinatura antes de confirmar.</Notice>
 <Field label="Assunto desta thread"><input readOnly value={replySubject}/></Field><Field label="Mensagem"><textarea rows={5} maxLength={65536} disabled={busy||disabled} value={text} onChange={e=>{reset();setText(e.target.value);drafts?.set(conversationId,e.target.value);setResult('');}}/></Field><Field label="Assinatura da caixa"><textarea readOnly value={mailbox.signature||'Sem assinatura configurada'} rows={2}/></Field>
 <div><Button variant="primary" disabled={busy||disabled||!text.trim()} onClick={()=>act(async()=>{flow.edit(fingerprint);const ticket=flow.begin(),value=await client.prepareReply(conversationId,{messageId,content:{kind:'email',subject:replySubject,text,signature:mailbox.signature}});if(flow.accept(ticket,value.review))setPrepared(value);})}>Revisar resposta</Button></div>
 {result&&<p role="status">{result}</p>}{error&&<p role="alert" className="error-bar">{error}</p>}
 {reviewing&&<Modal title="Revisar resposta de e-mail" onClose={()=>{if(!busy)reset();}}><div className="stack"><p>De: {prepared.review.snapshot.address}<br/>Para: {prepared.review.snapshot.to}</p><p>Em resposta a: {prepared.review.snapshot.thread?.inReplyTo}</p><div className="message-preview">{prepared.review.preview}</div>{prepared.review.blockers.map(b=><p role="alert" key={b}>{mailBlocker(b)}</p>)}<Notice>Confirmar coloca uma única resposta na fila. Aceitação pelo provedor não comprova entrega ou leitura.</Notice>{error&&<p role="alert">{error}</p>}<div className="form-actions"><Button disabled={busy} onClick={reset}>Editar</Button><Button variant="primary" disabled={busy||!!prepared.review.blockers.length} onClick={()=>act(async()=>{if(!flow.confirm())return;try{await client.confirmReply(prepared);}catch(e){flow.accept(flow.begin(),prepared.review);throw e;}reset();setText('');drafts?.delete(conversationId);setMessageId(crypto.randomUUID());setResult('Resposta adicionada à fila.');await onQueued();})}>Confirmar e colocar na fila</Button></div></div></Modal>}
 </section>;
}
