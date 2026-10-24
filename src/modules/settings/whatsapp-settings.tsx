"use client";
import {useEffect,useState,type ReactNode} from 'react';
import {Infinity as MetaIcon,MessageCircle,CheckCircle2,ShieldAlert} from 'lucide-react';
import {useLiveRefresh} from '@/client/use-live-refresh';
import {useChannels,useIdentity} from '@/client/workspace-provider';
import type {ConnectionView,OutboundContent,Provider,SenderView,TemplateView} from '@/domain/whatsapp';
import type {ChannelClient,TestSendReview} from '@/client/channel-client';
import type {MessagingLimitsView} from '@/server/channels/limits';
import {Button,Badge,Field,Modal,Notice,LinkButton} from '@/components/ui/primitives';
import {WhatsappConnectionForm} from './whatsapp-connection-form';
import {WhatsappContentField} from './whatsapp-content-field';
import {OpenwaConnection,OpenwaConnectModal} from './openwa-connection';
import {whatsappBlocker} from '@/client/whatsapp-copy';
const stateNames:Record<ConnectionView['state'],string>={pending:'Credenciais por verificar',credentials_verified:'Credenciais verificadas',awaiting_webhook:'Aguardando webhook',ready:'Pronta',attention:'Requer atenção',disconnected:'Desconectada'};

function VerifyToken({value,onHide}:{value:string;onHide:()=>void}){
 const [feedback,setFeedback]=useState(''),[failed,setFailed]=useState(false);
 async function copy(){
  setFeedback('');setFailed(false);
  try{await navigator.clipboard.writeText(value);setFeedback('Token copiado. Cole no campo de verificação da Meta.');}
  catch{setFailed(true);setFeedback('O navegador não permitiu copiar. Clique no token, pressione Ctrl+A e depois Ctrl+C.');}
 }
 return <div className="stack"><Field label="Verify token · copie para o callback da Meta"><input type="text" readOnly value={value} autoComplete="off" autoCapitalize="none" spellCheck={false} onFocus={e=>e.target.select()}/></Field><div className="row wrap"><Button onClick={copy}>Copiar token</Button><Button onClick={onHide}>Ocultar token</Button></div>{feedback&&<p role={failed?'alert':'status'}>{feedback}</p>}</div>;
}

function TestMessage({connection,client,onClose}:{connection:ConnectionView;client:ChannelClient;onClose:()=>void}){
 const [senderId,setSender]=useState(connection.senders[0]?.id??''),[phone,setPhone]=useState(''),[content,setContent]=useState<OutboundContent>({kind:'text',text:''}),[templates,setTemplates]=useState<TemplateView[]>([]),[evidence,setEvidence]=useState(''),[when,setWhen]=useState(''),[review,setReview]=useState<TestSendReview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
 useEffect(()=>{let active=true;client.templates(connection.id).then(v=>{if(active)setTemplates(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[client,connection.id]);
 async function act(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Falha ao preparar teste.');}finally{setBusy(false);}}
 return <Modal title="Teste de WhatsApp com destinatário autorizado" onClose={()=>{if(!busy)onClose();}}><div className="stack">
 <Notice>Use seu próprio número de teste ou um contato que autorizou este teste. Um telefone público de prospecção não é consentimento. A confirmação coloca uma mensagem na fila e pode gerar cobrança no provedor.</Notice>
 {!review&&!result?<><Field label="Remetente"><select value={senderId} onChange={e=>setSender(e.target.value)}><option value="">Selecione</option>{connection.senders.map(s=><option key={s.id} value={s.id}>{s.address??s.externalId}</option>)}</select></Field>
 <Field label="Telefone autorizado · formato +55…"><input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={16}/></Field>
 <WhatsappContentField capabilities={connection.capabilities} content={content} templates={templates} onChange={setContent}/>
 <Field label="Evidência da autorização para este teste" help="Descreva como e por quem o teste foi autorizado."><textarea rows={2} value={evidence} onChange={e=>setEvidence(e.target.value)} maxLength={4000}/></Field>
 <Field label="Quando a autorização foi obtida"><input type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)}/></Field>
 <Button variant="primary" disabled={busy||!senderId||!phone} onClick={()=>act(async()=>{setReview(await client.prepareTest(connection.id,{senderId,phone,content,...(evidence&&when?{consent:{source:'Declaração do administrador para teste',occurredAt:new Date(when).toISOString(),evidence}}:{})}));})}>{busy?'Preparando…':'Revisar teste'}</Button></>:null}
 {review&&!result&&<><h3>Confira antes de enviar</h3><p>Para: {review.review.snapshot.identity.phone??review.review.snapshot.identity.externalId}</p><div className="message-preview">{review.review.preview}</div><p className="muted">Revisão válida até {new Date(review.review.expiresAt).toLocaleTimeString('pt-BR')}. O worker revalida os limites antes do envio.</p>{review.review.blockers.map(b=><p role="alert" key={b}>{whatsappBlocker(b)}</p>)}<div className="form-actions"><Button disabled={busy} onClick={()=>setReview(null)}>Editar</Button><Button variant="primary" disabled={busy||review.review.blockers.length>0} onClick={()=>act(async()=>{const m=await client.confirmTest(review);setResult('Mensagem '+m.id+' adicionada à fila. Acompanhe a entrega na inbox.');})}>Confirmar e colocar na fila</Button></div></>}
 {error&&<p role="alert" className="error-bar">{error}</p>}{result&&<><p role="status">{result}</p><LinkButton href="/inbox">Abrir inbox</LinkButton></>}
 </div></Modal>;
}

export function LimitsForm({sender,limits,client,onSaved,platformDailyCap=20,platformNewConversationCap=5}:{sender:SenderView;limits:MessagingLimitsView;client:ChannelClient;onSaved:()=>Promise<void>;platformDailyCap?:number;platformNewConversationCap?:number}){
 const [workspaceDaily,setWorkspaceDaily]=useState(String(limits.workspaceDailyLimit??'')),[daily,setDaily]=useState(String(sender.dailyLimit??'')),[newDaily,setNewDaily]=useState(String(sender.newConversationLimit??5)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <form className="stack section-gap" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await client.setLimits(sender.connectionId,{expectedRevision:limits.revision,workspaceDailyLimit:Number(workspaceDaily),senderId:sender.id,senderDailyLimit:Number(daily),...(sender.provider==='openwa'?{senderNewConversationLimit:Number(newDaily)}:{})});await onSaved();}catch(e){setError(e instanceof Error?e.message:'Falha ao salvar limites.');}finally{setBusy(false);}}}>
 <h3>Limites · {sender.address??sender.externalId}</h3><div className="form-grid"><Field label="Máximo diário do workspace"><input type="number" min={1} max={100000} required value={workspaceDaily} onChange={e=>setWorkspaceDaily(e.target.value)}/></Field><Field label="Máximo diário deste remetente"><input type="number" min={1} max={sender.provider==='openwa'?platformDailyCap:100000} required value={daily} onChange={e=>setDaily(e.target.value)}/></Field>{sender.provider==='openwa'&&<Field label="Novos contatos autorizados por dia"><input type="number" min={1} max={Math.min(platformNewConversationCap,Number(daily)||platformDailyCap)} required value={newDaily} onChange={e=>setNewDaily(e.target.value)}/></Field>}</div>
 <small>Compartilhados por todas as cadências e respostas. Fuso: {limits.timezone}. Resultado incerto mantém a reserva até reconciliação.</small>{error&&<p role="alert">{error}</p>}<div><Button disabled={busy}>{busy?'Salvando…':'Salvar limites explícitos'}</Button></div></form>;
}

function ConnectionDetails({children,modal,title,onClose}:{children:ReactNode;modal:boolean;title:string;onClose:()=>void}){return modal?<Modal title={title} onClose={onClose}><div className="stack">{children}</div></Modal>:<div className="stack">{children}</div>;}

export function WhatsappSettings({limitsOnly=false}:{limitsOnly?:boolean}){
 const client=useChannels(),identity=useIdentity(),role=identity?.workspaces.find(w=>w.id===identity.activeWorkspaceId)?.role,canManage=role==='owner'||role==='admin';
 const [manage,setManage]=useState<'meta'|'openwa'|null>(null);
 const [connections,setConnections]=useState<ConnectionView[]|null>(null),[limits,setLimits]=useState<MessagingLimitsView|null>(null),[own,setOwn]=useState(false),[form,setForm]=useState<{provider:Provider;connection?:ConnectionView}|null>(null),[test,setTest]=useState<ConnectionView|null>(null),[token,setToken]=useState<{id:string;value:string}|null>(null),[disconnect,setDisconnect]=useState<ConnectionView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function refresh(){if(!client)return;const [c,l]=await Promise.all([client.list(),client.limits()]);setConnections(c);setLimits(l);}
 useEffect(()=>{let active=true;setManage(null);setConnections(null);setLimits(null);setToken(null);setOwn(false);setDisconnect(null);setForm(null);setTest(null);setError('');if(client)Promise.all([client.list(),client.limits()]).then(([c,l])=>{if(active){setConnections(c);setLimits(l);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[client]);
 async function act(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setNotice('');try{await fn();await refresh();}catch(e){setError(e instanceof Error?e.message:'Não foi possível concluir.');}finally{setBusy(false);}}
 const title=limitsOnly?'Limites de disparo':'WhatsApp';
 const statusLabel=(provider:'meta'|'openwa')=>{const rows=connections?.filter(c=>c.provider===provider)??[],ready=rows.find(c=>c.state==='ready');if(ready)return 'Conectado'+(ready.senders[0]?.address?' · '+ready.senders[0].address:'');return rows.some(c=>c.state!=='disconnected')?'Aguardando conexão':'Não conectado';};
 const openProvider=(provider:'meta'|'openwa')=>{if(connections?.some(c=>c.provider===provider)){setManage(provider);return;}if(provider==='openwa')setOwn(true);else setForm({provider:'meta'});};
 useLiveRefresh(async signal=>{if(!client||busy||form||own||test||disconnect)return;const c=await client.list();if(!signal.aborted)setConnections(c);},10000,!!client,client);
 if(!client)return <><h1>{title}</h1><Notice>Demonstração visual. Conexões reais exigem uma conta autenticada no workspace.</Notice></>;
 return <><div className="row between wrap"><div><h1>{title}</h1><p className="subtitle">{limitsOnly?'Defina o ritmo dos envios.':'Por qual número as cadências mandam mensagem.'}</p></div></div>
 {error&&<p role="alert" className="error-bar">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {connections===null?<p role="status">Consultando conexões…</p>:<>
 {!limitsOnly&&<div className="channel-cards whatsapp-provider-cards">
 <section className="panel panel-pad stack"><div className="whatsapp-provider-heading"><span className="whatsapp-provider-icon meta"><MetaIcon aria-hidden="true" size={26}/></span><div><h2>WhatsApp Oficial (Meta)</h2><p className="muted" role="status">{statusLabel('meta')}</p></div></div><ul className="whatsapp-provider-benefits"><li><CheckCircle2/>Converse com templates aprovados pela Meta</li><li><CheckCircle2/>Receba e acompanhe respostas no sistema</li><li><CheckCircle2/>Integração oficial do WhatsApp Business</li></ul>{canManage&&<div><Button variant="primary" aria-label="Conectar WhatsApp oficial" onClick={()=>openProvider('meta')}>{connections?.some(c=>c.provider==='meta')?'Gerenciar':'Conectar'}</Button></div>}</section>
 <section className="panel panel-pad stack"><div className="whatsapp-provider-heading"><span className="whatsapp-provider-icon own"><MessageCircle aria-hidden="true" size={24}/></span><div><h2>Número próprio</h2><p className="muted" role="status">{statusLabel('openwa')}</p></div></div><ul className="whatsapp-provider-benefits"><li><CheckCircle2/>Conecte seu WhatsApp pelo QR Code</li><li><CheckCircle2/>Responda e continue conversas</li><li className="caution"><ShieldAlert/>OpenWA não oficial: há risco de bloqueio</li></ul>{canManage&&<div><Button aria-label="Conectar número próprio" onClick={()=>openProvider('openwa')}>{connections?.some(c=>c.provider==='openwa'&&c.state==='ready')?'Gerenciar':'Conectar'}</Button></div>}</section>
 </div>}
 {!canManage&&<Notice>Somente proprietários e administradores gerenciam conexões, consentimentos e limites. Você pode acompanhar e responder pela inbox.</Notice>}
 {!limitsOnly&&!connections.some(c=>c.state==='ready')&&<p className="muted section-gap">Sem número conectado, as cadências de WhatsApp não saem.</p>}
 {(manage||limitsOnly)&&<ConnectionDetails modal={!limitsOnly} title={manage==='meta'?'WhatsApp Oficial · Meta':'Seu número · OpenWA'} onClose={()=>{setManage(null);setToken(null);}}>
 {manage==='openwa'&&<div><Button onClick={()=>{setManage(null);setOwn(true);}}>Conectar outro número</Button></div>}
 {connections.filter(c=>c.provider==='openwa'&&(limitsOnly||manage==='openwa')).map(c=><OpenwaConnection key={c.id} connection={c} client={client} canManage={canManage} onChanged={refresh} onTest={()=>{setManage(null);setTest(c);}}>{view=>c.senders.map(sender=>canManage&&limits?<LimitsForm key={sender.id+':'+limits.revision} platformDailyCap={view?.platformDailyCap} platformNewConversationCap={view?.platformNewConversationCap} sender={sender} limits={limits} client={client} onSaved={refresh}/>:null)}</OpenwaConnection>)}
 {connections.filter(c=>c.provider==='twilio'&&limitsOnly).map(c=><section className="panel panel-pad stack section-gap" key={c.id}><h2>{c.name}</h2><Badge>Twilio · aposentado</Badge><p>Conexão somente para leitura. O histórico e os resultados anteriores foram preservados.</p><LinkButton href="/messages/whatsapp">Abrir histórico</LinkButton></section>)}
 {connections.filter(c=>c.provider==='meta'&&(limitsOnly||manage==='meta')).map(c=><section className="panel panel-pad stack section-gap" key={c.id}><div className="row between wrap"><h2>{c.name}</h2><Badge tone={c.state==='ready'?'green':c.state==='attention'?'red':'neutral'}>{stateNames[c.state]}</Badge></div>
 <p>Meta Cloud API · revisão {c.revision}{c.tokenExpiresAt?' · token válido até '+new Date(c.tokenExpiresAt).toLocaleString('pt-BR'):''}</p>
 <div className="row wrap"><Badge tone={c.verification.credentials?'green':'neutral'}>Credenciais {c.verification.credentials?'verificadas':'pendentes'}</Badge>{c.provider==='meta'&&<Badge tone={c.verification.challenge?'green':'neutral'}>Challenge {c.verification.challenge?'confirmado':'pendente'}</Badge>}<Badge tone={c.verification.inbound?'green':'neutral'}>Webhook de entrada {c.verification.inbound?'validado':'pendente'}</Badge></div>
 {c.lastError&&<p role="status">Atenção: {c.lastError}</p>}
 <Field label="URL de callback"><input readOnly value={c.callbackUrl??c.callbackPath??''}/></Field>{!c.callbackUrl&&<Notice>Falta configurar a URL HTTPS pública do servidor. O caminho acima não é uma URL pública pronta.</Notice>}
 {canManage&&!limitsOnly&&<><div className="row wrap"><Button disabled={busy} onClick={()=>{setManage(null);setForm({provider:c.provider,connection:c});}}>Editar credenciais</Button><Button disabled={busy||c.state==='disconnected'} onClick={()=>act(async()=>{await client.verify(c.id,c.revision);setNotice('Verificação de credenciais concluída. Configure e valide o webhook.');})}>Verificar credenciais</Button><Button disabled={busy||!c.verification.credentials} onClick={()=>act(async()=>{const t=await client.syncTemplates(c.id,c.revision);setNotice(t.length+' templates sincronizados.');})}>Sincronizar templates</Button>{c.provider==='meta'&&<Button disabled={busy} onClick={()=>act(async()=>setToken({id:c.id,value:(await client.getVerifyToken(c.id,c.revision)).verifyToken}))}>Revelar verify token</Button>}<Button disabled={busy} onClick={()=>{setManage(null);setTest(c);}}>Preparar teste</Button><Button disabled={busy||c.state==='disconnected'} onClick={()=>{setManage(null);setDisconnect(c);}}>Desconectar</Button></div>
 {token?.id===c.id&&<VerifyToken key={c.id} value={token.value} onHide={()=>setToken(null)}/>}
 </>}
 {canManage&&c.state==='disconnected'&&<Button disabled={busy} onClick={()=>act(async()=>{await client.archive(c.id,c.revision);setManage(null);})}>Remover conexão</Button>}
 {c.senders.map(s=><div key={s.id}><p>Remetente: {s.address??s.externalId} · {s.ready?'pronto':'ativação pendente'} · {s.dailyLimit??'sem limite definido'}/dia</p>{canManage&&limits&&<LimitsForm key={s.id+':'+limits.revision} sender={s} limits={limits} client={client} onSaved={refresh}/>}</div>)}
 </section>)}
 </ConnectionDetails>}

 </>}
 {own&&canManage&&<OpenwaConnectModal client={client} onClose={()=>setOwn(false)} onChanged={refresh}/>}
 {form&&canManage&&<Modal title={form.connection?'Editar conexão':'Adicionar '+'Meta Cloud API'} onClose={()=>setForm(null)}><WhatsappConnectionForm provider={form.provider} connection={form.connection} client={client} onCancel={()=>setForm(null)} onSaved={async()=>{setForm(null);setToken(null);await refresh();}}/></Modal>}
 {test&&<TestMessage connection={test} client={client} onClose={()=>setTest(null)}/>}
 {disconnect&&<Modal title="Desconectar remetente" onClose={()=>{if(!busy)setDisconnect(null);}}><div className="stack"><p>Os envios pendentes desta conexão serão bloqueados. O histórico e os recibos serão preservados.</p><div className="form-actions"><Button disabled={busy} onClick={()=>setDisconnect(null)}>Cancelar</Button><Button disabled={busy} onClick={()=>act(async()=>{await client.disconnect(disconnect.id,disconnect.revision);setDisconnect(null);setToken(null);})}>Confirmar desconexão</Button></div></div></Modal>}
 </>;
}
