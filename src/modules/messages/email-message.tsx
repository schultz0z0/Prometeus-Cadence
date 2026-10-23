'use client';
import type {EmailMessageView} from '@/domain/mail';
import {splitQuotedMail} from '@/client/mail-display';
import {emailMessageStatus} from '@/client/mail-inbox-flow';
import {Badge,Button,Notice} from '@/components/ui/primitives';
export function EmailMessage({message:m,latest,canManage,onReconcile}:{message:EmailMessageView;latest:boolean;canManage:boolean;onReconcile:(id:string)=>void}){
 const raw=m.text??'',prefix=m.mail.subject+'\n\n',text=m.direction==='outbound'&&m.mail.origin==='app'&&raw.startsWith(prefix)?raw.slice(prefix.length):raw,{body,quoted}=splitQuotedMail(text);
 const sender=m.direction==='inbound'?m.mail.from:m.mail.origin==='external'?'Sua empresa · enviado fora do app':'Sua empresa';
 return <details className="email-message" open={latest}>
  <summary><span className="email-message-avatar" aria-hidden="true">{m.mail.from.slice(0,1).toUpperCase()}</span><span className="email-message-heading"><strong>{sender}</strong><span className="email-message-snippet">{body.replace(/\s+/g,' ').slice(0,140)||'Sem texto disponível'}</span></span><span className="email-message-meta"><time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time><Badge tone={m.state==='uncertain'||m.state==='failed'?'red':'neutral'}>{emailMessageStatus(m)}</Badge></span></summary>
  <div className="email-message-content"><p className="email-addresses">De: {m.mail.from}<br/>Para: {m.mail.to.join(', ')}</p><div className="email-message-body">{body||'Sem texto novo disponível'}</div>
   {quoted&&<details className="email-quoted"><summary>Mostrar mensagem anterior citada</summary><div className="email-message-body">{quoted}</div></details>}
   {m.mail.truncated&&<Notice>Conteúdo limitado durante a leitura. Confira a mensagem original na sua caixa.</Notice>}
   {m.mail.classification!=='human'&&<p className="email-addresses">{m.mail.classification==='automatic'?'Resposta automática':m.mail.classification==='dsn'?'Aviso de entrega':'Revisão necessária'}</p>}
   {m.mail.attachments.length>0&&<p>Anexos não importados: {m.mail.attachments.map(a=>a.name||a.type).join(', ')}</p>}
   <details className="email-technical"><summary>Detalhes da mensagem</summary><p>Assunto: {m.mail.subject||'Sem assunto'}</p><p>Message-ID: {m.mail.rfcMessageId||'Indisponível'}</p></details>
   {m.state==='uncertain'&&<><p>A tentativa pode ter sido aceita. Não há repetição automática.</p>{canManage&&<Button onClick={()=>onReconcile(m.id)}>Reconciliar com evidência</Button>}</>}{m.state==='dispatching'&&<p>Uma tentativa em andamento não pode ser recolhida.</p>}
  </div>
 </details>;
}
