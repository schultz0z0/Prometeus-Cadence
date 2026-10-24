"use client";
import {useEffect,useRef,useState} from 'react';
import {useChannels,useIdentity,useMessaging} from '@/client/workspace-provider';
import {useDemo} from '@/demo/provider';
import type {ConnectionView,ConversationView,MessageState,TemplateView} from '@/domain/whatsapp';
import type {ThreadView} from '@/client/messaging-client';
import {Button,Badge,EmptyState,Field,LinkButton,PageHeader,Notice} from '@/components/ui/primitives';
import {WhatsappReply} from './whatsapp-reply';
import {ReconciliationReview} from './reconciliation-review';
import {ConversationActions} from './conversation-actions';
import {useLiveRefresh} from '@/client/use-live-refresh';
import {mergeLiveItems} from '@/client/live-page';
const stateNames:Record<MessageState,string>={received:'Recebida',pending:'Na fila',dispatching:'Tentativa em andamento',accepted:'Aceita pelo provedor',delivered:'Entregue',read:'Lida',failed:'Falhou',uncertain:'Resultado incerto',cancelled:'Cancelada',blocked:'Bloqueada'};
export function WhatsappInbox(){
 const client=useMessaging(),channels=useChannels(),identity=useIdentity(),s=useDemo();
 const canManage=['owner','admin'].includes(identity?.workspaces.find(w=>w.id===identity.activeWorkspaceId)?.role??'');
 const [connections,setConnections]=useState<ConnectionView[]>([]),[items,setItems]=useState<ConversationView[]>([]),[nextCursor,setCursor]=useState<string|null>(null),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[senderFilter,setSenderFilter]=useState(''),[selected,setSelected]=useState(''),[thread,setThread]=useState<ThreadView|null>(null),[templates,setTemplates]=useState<TemplateView[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[reconcile,setReconcile]=useState('');
 const generation=useRef(0),listGeneration=useRef(0),selectedRef=useRef(selected);selectedRef.current=selected;
 const sender=connections.flatMap(c=>c.senders).find(s=>s.id===thread?.conversation.senderId);
 const connection=connections.find(c=>c.id===sender?.connectionId);
 const lead=thread?.conversation.leadId?s.leads.find(l=>l.id===thread.conversation.leadId):null;
 useEffect(()=>{let active=true;channels?.list().then(v=>{if(active)setConnections(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[channels]);
 useEffect(()=>{if(!client)return;const token=++listGeneration.current;setLoaded(false);setItems([]);setCursor(null);setError('');client.listConversations({search,...(senderFilter?{senderId:senderFilter}:{})}).then(v=>{if(token===listGeneration.current){setItems(v.items);setCursor(v.nextCursor);setLoaded(true);}}).catch(e=>{if(token===listGeneration.current)setError(e.message);});return()=>{listGeneration.current++;};},[client,search,senderFilter]);
 useEffect(()=>{if(!client||!selected)return;const token=++generation.current;setThread(null);setTemplates([]);setReconcile('');setError('');client.readConversation(selected).then(v=>{if(token===generation.current)setThread(v);}).catch(e=>{if(token===generation.current)setError(e.message);});return()=>{generation.current++;};},[client,selected]);
 useEffect(()=>{let active=true;setTemplates([]);if(channels&&connection)channels.templates(connection.id).then(t=>{if(active)setTemplates(t);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[channels,connection?.id]);
 async function refreshThread(){if(!client||!selected)return;const id=selected;const value=await client.readConversation(id);if(selectedRef.current===id){setThread(value);setItems(old=>old.map(v=>v.id===id?{...v,unread:value.conversation.unread}:v));}}
 async function act(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Não foi possível carregar.');}finally{setBusy(false);}}
 useLiveRefresh(async signal=>{
  if(!client||busy)return;const epoch=listGeneration.current,id=selectedRef.current;
  const page=await client.listConversations({search,...(senderFilter?{senderId:senderFilter}:{})});
  if(signal.aborted||epoch!==listGeneration.current)return;setItems(old=>mergeLiveItems(old,page.items));setCursor(old=>old??page.nextCursor);setLoaded(true);
  if(id){const fresh=await client.readConversation(id);if(!signal.aborted&&selectedRef.current===id)setThread(old=>old&&old.conversation.id===id?{...fresh,messages:[...old.messages.filter(m=>!fresh.messages.some(n=>n.id===m.id)),...fresh.messages],nextCursor:old.nextCursor}:fresh);}
 },5000,!!client,search+':'+senderFilter);
 useLiveRefresh(async signal=>{if(!channels)return;const value=await channels.list();if(!signal.aborted)setConnections(value);},10000,!!channels,channels);
 if(!client)return <><PageHeader title="Inbox WhatsApp"/><Notice>Demonstração visual sem conversas reais. Entre em um workspace para conectar sua conta.</Notice></>;
 return <><PageHeader title="Inbox WhatsApp" description="Conversas e estados reais dos seus remetentes." actions={<><LinkButton href="/settings/whatsapp">Conexões</LinkButton><Button disabled={busy} onClick={()=>act(async()=>{const token=++listGeneration.current;const result=await client.listConversations({search,...(senderFilter?{senderId:senderFilter}:{})});if(token===listGeneration.current){setItems(result.items);setCursor(result.nextCursor);setLoaded(true);}await refreshThread();})}>Atualizar</Button></>}/>
 {error&&<p role="alert" className="error-bar">{error}</p>}
 <div className="inbox-layout whatsapp-inbox"><aside className="inbox-sidebar"><form className="inbox-search" onSubmit={e=>{e.preventDefault();setSearch(query);}}><input aria-label="Buscar conversas por telefone ou identificador" placeholder="Telefone ou identificador…" value={query} onChange={e=>setQuery(e.target.value)} maxLength={200}/><Button>Buscar</Button></form><div className="panel-pad"><Field label="Remetente"><select value={senderFilter} onChange={e=>{setSenderFilter(e.target.value);setSelected('');setThread(null);}}><option value="">Todos</option>{connections.flatMap(c=>c.senders.map(s=><option key={s.id} value={s.id}>{c.name} · {s.address??s.externalId}</option>))}</select></Field></div>
 {!loaded&&!error&&<p role="status" className="panel-pad">Consultando conversas…</p>}{loaded&&!items.length&&<p className="thread-empty">Nenhuma conversa encontrada. As respostas chegam após validar o webhook do seu remetente.</p>}
 {items.map(v=><button className={`whatsapp-thread ${selected===v.id?'selected':''}`} key={v.id} aria-pressed={selected===v.id} onClick={()=>{setSelected(v.id);setReconcile('');}}><span><strong>{s.leads.find(l=>l.id===v.leadId)?.name??v.identity.phone??v.identity.externalId}</strong><small>{v.identity.phone??'Identidade opaca · sem telefone informado'}</small><small>{v.lastMessageAt?new Date(v.lastMessageAt).toLocaleString('pt-BR'):'Sem mensagens'}</small></span>{v.unread>0&&<Badge tone="orange">{v.unread} não lidas</Badge>}</button>)}
 {nextCursor&&<Button disabled={busy} onClick={()=>act(async()=>{const token=listGeneration.current;const page=await client.listConversations({search,cursor:nextCursor,...(senderFilter?{senderId:senderFilter}:{})});if(token===listGeneration.current){setItems(old=>[...old,...page.items.filter(v=>!old.some(x=>x.id===v.id))]);setCursor(page.nextCursor);}})}>Mais conversas</Button>}
 </aside><section className="inbox-detail">
 {!selected?<EmptyState icon="MessageSquare" title="Selecione uma conversa" description="O histórico pode existir mesmo sem empresa vinculada ou telefone informado pelo provedor."/>:!thread||thread.conversation.id!==selected?<p className="panel-pad" role="status">Carregando histórico…</p>:<div key={thread.conversation.id}><div className="thread-header stack"><div className="row between wrap"><h2>{lead?.name??thread.conversation.identity.phone??thread.conversation.identity.externalId}</h2><Badge>{connection?.name??'Remetente'}</Badge></div><small>{thread.conversation.identity.scope} · {thread.conversation.identity.externalId}</small><p>{lead?'Empresa vinculada: '+lead.name:'Conversa sem empresa vinculada'}</p>
 <div><Button disabled={busy||!thread.messages.length} onClick={()=>act(async()=>{await client.markRead(thread.conversation.id,thread.messages.at(-1)!.id);await refreshThread();})}>Marcar mensagens exibidas como lidas</Button></div></div>
 {thread.nextCursor&&<div className="panel-pad"><Button disabled={busy} onClick={()=>act(async()=>{const id=thread.conversation.id,page=await client.readConversation(id,thread.nextCursor!);if(selectedRef.current===id)setThread(old=>old?{...old,messages:[...page.messages.filter(m=>!old.messages.some(x=>x.id===m.id)),...old.messages],nextCursor:page.nextCursor}:old);})}>Carregar mensagens anteriores</Button></div>}
 <div className="whatsapp-history" aria-label="Histórico da conversa">{thread.messages.map(m=><article className={`whatsapp-message ${m.direction}`} key={m.id}><div className="row between wrap"><strong>{m.direction==='inbound'?'Contato':'Sua empresa'}</strong><Badge tone={m.state==='uncertain'||m.state==='failed'?'red':'neutral'}>{stateNames[m.state]}</Badge></div><p>{m.text??(m.mediaKind?'Mídia recebida · '+m.mediaKind:'Mensagem sem texto')}</p>{m.mediaKind&&m.text&&<small>Mídia: {m.mediaKind}</small>}<small>{new Date(m.createdAt).toLocaleString('pt-BR')}{m.remoteId?' · '+m.remoteId:''}</small>{m.state==='uncertain'&&<><p>O provedor pode ter recebido a mensagem. Não há repetição automática.</p>{canManage&&<Button onClick={()=>setReconcile(m.id)}>Reconciliar com evidência</Button>}</>}{m.state==='dispatching'&&<small>Uma tentativa em andamento não pode ser recolhida.</small>}</article>)}</div>
 {canManage&&<ConversationActions conversation={thread.conversation} client={client} onSaved={refreshThread}/>}
 <WhatsappReply capabilities={sender?.capabilities} conversationId={thread.conversation.id} client={client} templates={templates} onQueued={refreshThread}/>
 </div>}
 </section></div>{reconcile&&<ReconciliationReview messageId={reconcile} client={client} onClose={()=>setReconcile('')} onSaved={refreshThread}/>}
 </>;
}
