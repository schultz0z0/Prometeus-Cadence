"use client";
import {useEffect,useState} from 'react';
import {useLiveRefresh} from '@/client/use-live-refresh';
import {useChannels,useIdentity} from '@/client/workspace-provider';
import type {ConnectionView,OutboundContent,Provider,SenderView,TemplateView} from '@/domain/whatsapp';
import type {ChannelClient,TestSendReview} from '@/client/channel-client';
import type {MessagingLimitsView} from '@/server/channels/limits';
import {Button,Badge,Field,Modal,Notice,EmptyState,LinkButton} from '@/components/ui/primitives';
import {WhatsappConnectionForm} from './whatsapp-connection-form';
import {WhatsappContentField} from './whatsapp-content-field';
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
 <WhatsappContentField content={content} templates={templates} onChange={setContent}/>
 <Field label="Evidência da autorização para este teste" help="Descreva como e por quem o teste foi autorizado."><textarea rows={2} value={evidence} onChange={e=>setEvidence(e.target.value)} maxLength={4000}/></Field>
 <Field label="Quando a autorização foi obtida"><input type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)}/></Field>
 <Button variant="primary" disabled={busy||!senderId||!phone} onClick={()=>act(async()=>{setReview(await client.prepareTest(connection.id,{senderId,phone,content,...(evidence&&when?{consent:{source:'Declaração do administrador para teste',occurredAt:new Date(when).toISOString(),evidence}}:{})}));})}>{busy?'Preparando…':'Revisar teste'}</Button></>:null}
 {review&&!result&&<><h3>Confira antes de enviar</h3><p>Para: {review.review.snapshot.identity.phone??review.review.snapshot.identity.externalId}</p><div className="message-preview">{review.review.preview}</div><p className="muted">Revisão válida até {new Date(review.review.expiresAt).toLocaleTimeString('pt-BR')}. O worker revalida os limites antes do envio.</p>{review.review.blockers.map(b=><p role="alert" key={b}>{whatsappBlocker(b)}</p>)}<div className="form-actions"><Button disabled={busy} onClick={()=>setReview(null)}>Editar</Button><Button variant="primary" disabled={busy||review.review.blockers.length>0} onClick={()=>act(async()=>{const m=await client.confirmTest(review);setResult('Mensagem '+m.id+' adicionada à fila. Acompanhe a entrega na inbox.');})}>Confirmar e colocar na fila</Button></div></>}
 {error&&<p role="alert" className="error-bar">{error}</p>}{result&&<><p role="status">{result}</p><LinkButton href="/inbox">Abrir inbox</LinkButton></>}
 </div></Modal>;
}

function LimitsForm({sender,limits,client,onSaved}:{sender:SenderView;limits:MessagingLimitsView;client:ChannelClient;onSaved:()=>Promise<void>}){
 const [workspaceDaily,setWorkspaceDaily]=useState(String(limits.workspaceDailyLimit??'')),[daily,setDaily]=useState(String(sender.dailyLimit??'')),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <form className="stack section-gap" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await client.setLimits(sender.connectionId,{expectedRevision:limits.revision,workspaceDailyLimit:Number(workspaceDaily),senderId:sender.id,senderDailyLimit:Number(daily)});await onSaved();}catch(e){setError(e instanceof Error?e.message:'Falha ao salvar limites.');}finally{setBusy(false);}}}>
 <h3>Limites · {sender.address??sender.externalId}</h3><div className="form-grid"><Field label="Máximo diário do workspace"><input type="number" min={1} max={100000} required value={workspaceDaily} onChange={e=>setWorkspaceDaily(e.target.value)}/></Field><Field label="Máximo diário deste remetente"><input type="number" min={1} max={100000} required value={daily} onChange={e=>setDaily(e.target.value)}/></Field></div>
 <small>Compartilhados por todas as cadências e respostas. Fuso: {limits.timezone}. Resultado incerto mantém a reserva até reconciliação.</small>{error&&<p role="alert">{error}</p>}<div><Button disabled={busy}>{busy?'Salvando…':'Salvar limites explícitos'}</Button></div></form>;
}

export function WhatsappSettings({limitsOnly=false}:{limitsOnly?:boolean}){
 const client=useChannels(),identity=useIdentity(),role=identity?.workspaces.find(w=>w.id===identity.activeWorkspaceId)?.role,canManage=role==='owner'||role==='admin';
 const [connections,setConnections]=useState<ConnectionView[]|null>(null),[limits,setLimits]=useState<MessagingLimitsView|null>(null),[form,setForm]=useState<{provider:Provider;connection?:ConnectionView}|null>(null),[test,setTest]=useState<ConnectionView|null>(null),[token,setToken]=useState<{id:string;value:string}|null>(null),[disconnect,setDisconnect]=useState<ConnectionView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function refresh(){if(!client)return;const [c,l]=await Promise.all([client.list(),client.limits()]);setConnections(c);setLimits(l);}
 useEffect(()=>{let active=true;setConnections(null);setLimits(null);setToken(null);setForm(null);setTest(null);setError('');if(client)Promise.all([client.list(),client.limits()]).then(([c,l])=>{if(active){setConnections(c);setLimits(l);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[client]);
 async function act(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setNotice('');try{await fn();await refresh();}catch(e){setError(e instanceof Error?e.message:'Não foi possível concluir.');}finally{setBusy(false);}}
 const title=limitsOnly?'Limites de disparo':'WhatsApp';
 useLiveRefresh(async signal=>{if(!client||busy||form||test||disconnect)return;const c=await client.list();if(!signal.aborted)setConnections(c);},10000,!!client,client);
 if(!client)return <><h1>{title}</h1><Notice>Demonstração visual. Conexões reais exigem uma conta autenticada no workspace.</Notice></>;
 return <><div className="row between wrap"><div><h1>{title}</h1><p className="subtitle">Conecte a conta da sua empresa e acompanhe cada etapa de ativação.</p></div><Button disabled={busy} onClick={()=>act(refresh)}>Atualizar estado</Button></div>
 {error&&<p role="alert" className="error-bar">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {connections===null?<p role="status">Consultando conexões…</p>:<>
 {!limitsOnly&&<div className="channel-cards">{(['meta','twilio'] as const).map(provider=><section className="panel panel-pad stack" key={provider}><h2>{provider==='meta'?'WhatsApp Oficial · Meta':'WhatsApp · Twilio'}</h2><p>{provider==='meta'?'Use a Cloud API e os templates aprovados da sua conta Meta.':'Use um remetente habilitado para WhatsApp na sua conta Twilio.'}</p><small>{connections.filter(c=>c.provider===provider).length} conexões neste workspace</small>{canManage&&<div><Button variant={provider==='meta'?'primary':''} onClick={()=>setForm({provider})}>Adicionar conexão</Button></div>}</section>)}</div>}
 {!canManage&&<Notice>Somente proprietários e administradores gerenciam conexões, consentimentos e limites. Você pode acompanhar e responder pela inbox.</Notice>}
 {!connections.length&&<EmptyState icon="MessageSquare" title="Nenhuma conexão de WhatsApp" description="Adicione Meta ou Twilio para configurar o primeiro remetente. Salvar uma conexão não envia mensagens."/>}
 {connections.map(c=><section className="panel panel-pad stack section-gap" key={c.id}><div className="row between wrap"><h2>{c.name}</h2><Badge tone={c.state==='ready'?'green':c.state==='attention'?'red':'neutral'}>{stateNames[c.state]}</Badge></div>
 <p>{c.provider==='meta'?'Meta Cloud API':'Twilio'} · revisão {c.revision}{c.tokenExpiresAt?' · token válido até '+new Date(c.tokenExpiresAt).toLocaleString('pt-BR'):''}</p>
 <div className="row wrap"><Badge tone={c.verification.credentials?'green':'neutral'}>Credenciais {c.verification.credentials?'verificadas':'pendentes'}</Badge>{c.provider==='meta'&&<Badge tone={c.verification.challenge?'green':'neutral'}>Challenge {c.verification.challenge?'confirmado':'pendente'}</Badge>}<Badge tone={c.verification.inbound?'green':'neutral'}>Webhook de entrada {c.verification.inbound?'validado':'pendente'}</Badge></div>
 {c.lastError&&<p role="status">Atenção: {c.lastError}</p>}
 <Field label="URL de callback"><input readOnly value={c.callbackUrl??c.callbackPath??''}/></Field>{!c.callbackUrl&&<Notice>Falta configurar a URL HTTPS pública do servidor. O caminho acima não é uma URL pública pronta.</Notice>}
 {c.callbackStatusUrl&&<Field label="Callback de status · Twilio"><input readOnly value={c.callbackStatusUrl}/></Field>}
 {canManage&&!limitsOnly&&<><div className="row wrap"><Button disabled={busy} onClick={()=>setForm({provider:c.provider,connection:c})}>Editar credenciais</Button><Button disabled={busy||c.state==='disconnected'} onClick={()=>act(async()=>{await client.verify(c.id,c.revision);setNotice('Verificação de credenciais concluída. Configure e valide o webhook.');})}>Verificar credenciais</Button><Button disabled={busy||!c.verification.credentials} onClick={()=>act(async()=>{const t=await client.syncTemplates(c.id,c.revision);setNotice(t.length+' templates sincronizados.');})}>Sincronizar templates</Button>{c.provider==='meta'&&<Button disabled={busy} onClick={()=>act(async()=>setToken({id:c.id,value:(await client.getVerifyToken(c.id,c.revision)).verifyToken}))}>Revelar verify token</Button>}<Button disabled={busy} onClick={()=>setTest(c)}>Preparar teste</Button><Button disabled={busy||c.state==='disconnected'} onClick={()=>setDisconnect(c)}>Desconectar</Button></div>
 {token?.id===c.id&&<VerifyToken key={c.id} value={token.value} onHide={()=>setToken(null)}/>}
 </>}
 {c.senders.map(s=><div key={s.id}><p>Remetente: {s.address??s.externalId} · {s.ready?'pronto':'ativação pendente'} · {s.dailyLimit??'sem limite definido'}/dia</p>{canManage&&limits&&<LimitsForm key={s.id+':'+limits.revision} sender={s} limits={limits} client={client} onSaved={refresh}/>}</div>)}
 </section>)}
 {!limitsOnly&&<details className="panel panel-pad section-gap"><summary>Como preparar a conta no provedor</summary><div className="stack section-gap"><h3>Meta Cloud API</h3><ol><li>Crie um aplicativo com o produto WhatsApp no Meta for Developers e escolha a sua conta empresarial.</li><li>Em Configuração da API, copie App ID, WABA ID e Phone Number ID. Para o piloto, use o número de teste e adicione um destinatário autorizado na Meta.</li><li>Informe access token com acesso à conta e permissões whatsapp_business_management e whatsapp_business_messaging, além do App secret.</li><li>Salve e verifique aqui. No provedor, configure o callback HTTPS e o verify token revelado por você.</li><li>Assine explicitamente o aplicativo na WABA e o campo messages nos webhooks. O challenge confirma a URL; um webhook assinado confirma o caminho de entrada.</li><li>Sincronize templates aprovados, defina os limites e revise um teste antes de confirmar.</li></ol><a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">Abrir aplicativos da Meta</a><h3>Twilio</h3><p>Habilite um remetente WhatsApp na conta. A API Key e seu secret autenticam REST; o Auth Token da conta continua obrigatório para verificar assinaturas de webhooks. Configure os callbacks de entrada e de status exibidos nesta tela e sincronize os templates de Content aprovados para WhatsApp.</p><a href="https://console.twilio.com/" target="_blank" rel="noreferrer">Abrir console Twilio</a></div></details>}
 </>}
 {form&&<Modal title={form.connection?'Editar conexão':'Adicionar '+(form.provider==='meta'?'Meta Cloud API':'Twilio')} onClose={()=>setForm(null)}><WhatsappConnectionForm provider={form.provider} connection={form.connection} client={client} onCancel={()=>setForm(null)} onSaved={async()=>{setForm(null);setToken(null);await refresh();}}/></Modal>}
 {test&&<TestMessage connection={test} client={client} onClose={()=>setTest(null)}/>}
 {disconnect&&<Modal title="Desconectar remetente" onClose={()=>{if(!busy)setDisconnect(null);}}><div className="stack"><p>Os envios pendentes desta conexão serão bloqueados. O histórico e os recibos serão preservados.</p><div className="form-actions"><Button disabled={busy} onClick={()=>setDisconnect(null)}>Cancelar</Button><Button disabled={busy} onClick={()=>act(async()=>{await client.disconnect(disconnect.id,disconnect.revision);setDisconnect(null);setToken(null);})}>Confirmar desconexão</Button></div></div></Modal>}
 </>;
}
