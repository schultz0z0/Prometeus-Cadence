"use client";
import {useRef,useState} from 'react';
import type {MessagingClient,ReplyReview} from '@/client/messaging-client';
import type {OutboundContent,PreparedSend,TemplateView} from '@/domain/whatsapp';
import {Button,Modal,Notice} from '@/components/ui/primitives';
import {Icon} from '@/components/ui/icon';
import {WhatsappContentField} from '@/modules/settings/whatsapp-content-field';
import {useMessagingReview} from './use-messaging-review';
import type {WhatsappCapabilities} from '@/domain/whatsapp-capabilities';
import {whatsappBlocker} from '@/client/whatsapp-copy';
import {EmojiPicker} from './emoji-picker';
import {SelectField} from '@/components/ui/select-field';
// Chat-style composer: Enter prepares and, when the server finds no blocker, confirms in one go. A blocker or a failed
// confirmation opens the review, and a retry reuses the same prepared command, so a lost response never sends twice.
export function WhatsappReply({conversationId,client,templates,onQueued,capabilities,initialText=''}:{initialText?:string;conversationId:string;client:MessagingClient;templates:TemplateView[];onQueued:()=>Promise<void>;capabilities?:WhatsappCapabilities}){
 const [content,setContent]=useState<OutboundContent>({kind:'text',text:initialText}),[prepared,setPrepared]=useState<ReplyReview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef(false),input=useRef<HTMLTextAreaElement>(null);
 const fingerprint=JSON.stringify({conversationId,content}),{flow,state}=useMessagingReview<PreparedSend>(fingerprint);
 const approved=capabilities?.supportsOfficialTemplates===false?[]:templates.filter(t=>t.status==='approved'),textAllowed=capabilities?.supportsText!==false;
 async function act(fn:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Não foi possível concluir.');}finally{pending.current=false;setBusy(false);}}
 function edit(v:OutboundContent){flow.reset();setPrepared(null);setContent(v);}
 async function confirm(p:ReplyReview){if(!flow.confirm())return;try{await client.confirmReply(p);flow.reset();setPrepared(null);setContent({kind:'text',text:''});await onQueued();input.current?.focus();}catch(e){flow.accept(flow.begin(),p.review);setPrepared(p);throw e;}}
 function send(){if(content.kind==='text'&&!content.text.trim())return;void act(async()=>{flow.edit(fingerprint);const ticket=flow.begin(),p=await client.prepareReply(conversationId,{content});if(!flow.accept(ticket,p.review))return;if(p.review.blockers.length){setPrepared(p);return;}await confirm(p);});}
 function insert(emoji:string){if(content.kind!=='text')return;const el=input.current,start=el?.selectionStart??content.text.length,end=el?.selectionEnd??start,text=content.text.slice(0,start)+emoji+content.text.slice(end);if(text.length>4096)return;edit({kind:'text',text});requestAnimationFrame(()=>{el?.focus();el?.setSelectionRange(start+emoji.length,start+emoji.length);});}
 const hint=capabilities?.requiresServiceWindow===false?'Número próprio OpenWA: respeite a autorização do contato, as cotas e o risco de bloqueio.':'Texto livre só até 24 horas após a última mensagem recebida. Fora dessa janela, use um template aprovado.';
 return <section className="whatsapp-composer" aria-label="Responder por WhatsApp">
  <small className="whatsapp-composer-hint" title={hint}>{hint}</small>
  {content.kind==='template'?<form className="stack" onSubmit={e=>{e.preventDefault();send();}}><fieldset disabled={busy} className="channel-fields"><legend>Template desta conversa</legend><WhatsappContentField capabilities={capabilities} content={content} templates={templates} onChange={edit}/></fieldset><div><Button variant="primary" disabled={busy}>{busy?'Enviando…':'Enviar template'}</Button></div></form>
  :<form className="whatsapp-composer-row" onSubmit={e=>{e.preventDefault();send();}}>
   <EmojiPicker onPick={insert} disabled={busy||!textAllowed}/>
   {approved.length>0&&<SelectField className="whatsapp-composer-mode" aria-label="Tipo de mensagem" value="text" disabled={busy} onChange={e=>{const t=approved.find(t=>t.id===e.target.value);if(t)edit({kind:'template',templateId:t.id,templateRevision:t.revision,variables:{}});}}><option value="text">Texto</option>{approved.map(t=><option key={t.id} value={t.id}>{t.name} · {t.language}</option>)}</SelectField>}
   <textarea ref={input} aria-label="Mensagem" placeholder={textAllowed?'Digite uma mensagem':'Este remetente não envia texto livre'} rows={1} maxLength={4096} readOnly={busy} disabled={!textAllowed} value={content.text} onChange={e=>edit({kind:'text',text:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/>
   <button type="submit" className="whatsapp-send" disabled={busy||!textAllowed||!content.text.trim()} aria-label={busy?'Enviando…':'Enviar mensagem'} title="Enviar (Enter) · nova linha com Shift+Enter"><Icon name={busy?'LoaderCircle':'Send'} size={18}/></button>
  </form>}
  {error&&!prepared&&<p role="alert" className="error-bar">{error}</p>}
  {prepared&&(state.kind==='reviewing'||state.kind==='blocked'||state.kind==='confirming')&&<Modal title={prepared.review.blockers.length?'Esta resposta não pode ser enviada':'Revisar resposta antes de enviar'} onClose={()=>{if(!busy){flow.reset();setPrepared(null);}}}><div className="stack"><p>Para: {prepared.review.snapshot.identity.phone??prepared.review.snapshot.identity.externalId}</p><div className="message-preview">{prepared.review.preview}</div>{prepared.review.blockers.map(b=><p role="alert" key={b}>{whatsappBlocker(b)}</p>)}<Notice>Confirmar adiciona à fila. O provedor ainda precisa aceitar a mensagem e confirmar a entrega.</Notice>{error&&<p role="alert">{error}</p>}<div className="form-actions"><Button disabled={busy} onClick={()=>{flow.reset();setPrepared(null);}}>Voltar</Button><Button variant="primary" disabled={busy||!!prepared.review.blockers.length} onClick={()=>act(()=>confirm(prepared))}>Confirmar e colocar na fila</Button></div></div></Modal>}
 </section>;
}
