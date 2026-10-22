'use client';
import {useRef,useState} from 'react';
import type {MailClient,MailDetail,MailboxSaveCommand} from '@/client/mail-client';
import type {MailProvider} from '@/domain/mail';
import {Button,Field,Notice} from '@/components/ui/primitives';
export function EmailConnectionForm({client,provider,detail,onSaved,onCancel}:{client:MailClient;provider:MailProvider;detail?:MailDetail;onSaved:()=>Promise<void>;onCancel:()=>void}){
 const box=detail?.mailbox,config=detail?.config&&'smtpHost'in detail.config?detail.config:null;
 const [name,setName]=useState(box?.name??''),[address,setAddress]=useState(box?.address??''),[signature,setSignature]=useState(box?.signature??''),[smtpHost,setSmtpHost]=useState(config?.smtpHost??''),[smtpPort,setSmtpPort]=useState(config?.smtpPort??465),[imapHost,setImapHost]=useState(config?.imapHost??''),[smtpUser,setSmtpUser]=useState(config?.smtpUser??''),[imapUser,setImapUser]=useState(config?.imapUser??''),[inbox,setInbox]=useState(config?.inbox??'INBOX'),[sent,setSent]=useState(config?.sentFolder??''),[smtpPassword,setSmtpPassword]=useState(''),[imapPassword,setImapPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(false),payload=useRef<{fingerprint:string;input:MailboxSaveCommand}|null>(null);
 return <form className="stack" onSubmit={async event=>{event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');
  const common={...(box?{id:box.id}:{}),expectedRevision:box?.revision??0,name,signature},input:MailboxSaveCommand=provider==='gmail'?{...common,provider,config:{},credentials:{}}:{...common,provider,address,config:{smtpHost,smtpPort:smtpPort as 465|587,imapHost,imapPort:993,smtpUser,imapUser,inbox,sentFolder:sent||null},credentials:{smtpPassword,imapPassword}};
  const fingerprint=JSON.stringify(input);if(payload.current?.fingerprint!==fingerprint)payload.current={fingerprint,input};
  try{await client.save(payload.current!.input);setSmtpPassword('');setImapPassword('');payload.current=null;await onSaved();}catch(error){setError(error instanceof Error?error.message:'Não foi possível salvar.');}finally{pending.current=false;setBusy(false);}
 }}>
 <Notice>Salvar mantém a conexão pendente. A verificação, a sincronização e o envio de teste são ações separadas.</Notice>
 <Field label="Nome da caixa"><input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></Field>
 {provider==='gmail'?<p>Depois de salvar, use “Conectar com Google” para autorizar envio e leitura. O servidor precisa ter o cliente OAuth configurado.</p>:<>
 <Field label="Endereço de e-mail"><input type="email" required value={address} onChange={e=>setAddress(e.target.value)} maxLength={254} readOnly={!!box?.address&&box.state==='ready'}/></Field>
 <div className="field-grid"><Field label="Servidor SMTP"><input required value={smtpHost} onChange={e=>setSmtpHost(e.target.value)} placeholder="smtp.seudominio.com"/></Field><Field label="Porta SMTP"><select value={smtpPort} onChange={e=>setSmtpPort(Number(e.target.value) as 465|587)}><option value={465}>465 · TLS</option><option value={587}>587 · STARTTLS obrigatório</option></select></Field></div>
 <Field label="Usuário SMTP"><input required autoComplete="off" value={smtpUser} onChange={e=>setSmtpUser(e.target.value)}/></Field>
 <Field label="Senha SMTP" help={box?'Deixe em branco para preservar a senha salva.':undefined}><input type="password" required={!box} autoComplete="new-password" value={smtpPassword} onChange={e=>setSmtpPassword(e.target.value)}/></Field>
 <div className="field-grid"><Field label="Servidor IMAP"><input required value={imapHost} onChange={e=>setImapHost(e.target.value)} placeholder="imap.seudominio.com"/></Field><Field label="Porta IMAP"><input readOnly value="993 · TLS"/></Field></div>
 <Field label="Usuário IMAP"><input required autoComplete="off" value={imapUser} onChange={e=>setImapUser(e.target.value)}/></Field>
 <Field label="Senha IMAP" help={box?'Deixe em branco para preservar a senha salva.':undefined}><input type="password" required={!box} autoComplete="new-password" value={imapPassword} onChange={e=>setImapPassword(e.target.value)}/></Field>
 <div className="field-grid"><Field label="Pasta de entrada"><input required value={inbox} onChange={e=>setInbox(e.target.value)}/></Field><Field label="Pasta de enviados (opcional)"><input value={sent} onChange={e=>setSent(e.target.value)} placeholder="Nome exato no provedor"/></Field></div>
 <small>A leitura preserva os sinalizadores da caixa e não grava mensagens na pasta de enviados.</small>
 </>}
 <Field label="Assinatura em texto"><textarea rows={3} value={signature} maxLength={4096} onChange={e=>setSignature(e.target.value)}/></Field>
 {error&&<p role="alert" className="error-bar">{error}</p>}<div className="form-actions"><Button type="button" disabled={busy} onClick={onCancel}>Cancelar</Button><Button variant="primary" disabled={busy}>{busy?'Salvando…':'Salvar configuração'}</Button></div>
 </form>;
}
