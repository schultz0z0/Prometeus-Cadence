"use client";
import { SelectField } from "@/components/ui/select-field";
import {useEffect,useRef,useState} from 'react';
import {useChannels,useIdentity,useMessaging} from '@/client/workspace-provider';
import {useDemo} from '@/demo/provider';
import type {ConnectionView,ConversationView,TemplateView} from '@/domain/whatsapp';
import type {ThreadView} from '@/client/messaging-client';
import {Button,Badge,EmptyState,IconButton,LinkButton,Modal,PageHeader,Notice} from '@/components/ui/primitives';
import {Icon} from '@/components/ui/icon';
import {WhatsappReply} from './whatsapp-reply';
import {WhatsappHistory} from './whatsapp-history';
import {SdrConversationControls} from '@/modules/sdr/conversation-controls';
import {ReconciliationReview} from './reconciliation-review';
import {ConversationActions} from './conversation-actions';
import {useLiveRefresh} from '@/client/use-live-refresh';
import {mergeLiveItems} from '@/client/live-page';
import {mergeLatest,prependOlder} from '@/client/whatsapp-thread';
import {useAssistantDraft} from '@/client/use-assistant-draft';
// A phone number has no initials (its first digit is the country code), so it gets the person icon.
const initials=(name:string)=>name.replace(/[^\p{L} ]/gu,'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
const avatar=(name:string)=>initials(name)||<Icon name="User" size={16}/>;
const listTime=(iso:string)=>{const d=new Date(iso),now=new Date();return d.toDateString()===now.toDateString()?d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});};
export function WhatsappInbox(){
 const client=useMessaging(),channels=useChannels(),identity=useIdentity(),s=useDemo();
 const canManage=['owner','admin'].includes(identity?.workspaces.find(w=>w.id===identity.activeWorkspaceId)?.role??'');
 const [connections,setConnections]=useState<ConnectionView[]>([]),[items,setItems]=useState<ConversationView[]>([]),[nextCursor,setCursor]=useState<string|null>(null),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[senderFilter,setSenderFilter]=useState(''),[selected,setSelected]=useState(''),[thread,setThread]=useState<ThreadView|null>(null),[templates,setTemplates]=useState<TemplateView[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[channelsLoaded,setChannelsLoaded]=useState(false),[reconcile,setReconcile]=useState(''),[manage,setManage]=useState(false);
 const draft=useAssistantDraft();
 useEffect(()=>{if(draft)setSelected(draft.conversationId);},[draft]);
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get('conversation');if(id)setSelected(id);},[]);
 const generation=useRef(0),listGeneration=useRef(0),selectedRef=useRef(selected);selectedRef.current=selected;
 const sender=connections.flatMap(c=>c.senders).find(s=>s.id===thread?.conversation.senderId);
 const connection=connections.find(c=>c.id===sender?.connectionId);
 const lead=thread?.conversation.leadId?s.leads.find(l=>l.id===thread.conversation.leadId):null;
 useEffect(()=>{let active=true;channels?.list().then(v=>{if(active){setConnections(v);setChannelsLoaded(true);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[channels]);
 useEffect(()=>{if(!client)return;const token=++listGeneration.current;setLoaded(false);setItems([]);setCursor(null);setError('');client.listConversations({search,...(senderFilter?{senderId:senderFilter}:{})}).then(v=>{if(token===listGeneration.current){setItems(v.items);setCursor(v.nextCursor);setLoaded(true);}}).catch(e=>{if(token===listGeneration.current)setError(e.message);});return()=>{listGeneration.current++;};},[client,search,senderFilter]);
 useEffect(()=>{if(!client||!selected)return;const token=++generation.current;setThread(null);setTemplates([]);setReconcile('');setManage(false);setError('');client.readConversation(selected).then(v=>{if(token===generation.current)setThread(v);}).catch(e=>{if(token===generation.current)setError(e.message);});return()=>{generation.current++;};},[client,selected]);
 useEffect(()=>{let active=true;setTemplates([]);if(channels&&connection)channels.templates(connection.id).then(t=>{if(active)setTemplates(t);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[channels,connection?.id]);
 // Refreshing reads only the newest page and merges it: older pages the person already scrolled through stay loaded.
 async function refreshThread(){if(!client||!selected)return;const id=selected;const value=await client.readConversation(id);if(selectedRef.current===id){setThread(old=>old&&old.conversation.id===id?mergeLatest(old,value):value);setItems(old=>old.map(v=>v.id===id?{...v,unread:value.conversation.unread}:v));}}
 async function act(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Não foi possível carregar.');}finally{setBusy(false);}}
 useLiveRefresh(async signal=>{
  if(!client||busy)return;const epoch=listGeneration.current,id=selectedRef.current;
  const page=await client.listConversations({search,...(senderFilter?{senderId:senderFilter}:{})});
  if(signal.aborted||epoch!==listGeneration.current)return;setItems(old=>mergeLiveItems(old,page.items));setCursor(old=>old??page.nextCursor);setLoaded(true);
  if(id){const fresh=await client.readConversation(id);if(!signal.aborted&&selectedRef.current===id)setThread(old=>old&&old.conversation.id===id?mergeLatest(old,fresh):fresh);}
 },5000,!!client,search+':'+senderFilter);
 useLiveRefresh(async signal=>{if(!channels)return;const value=await channels.list();if(!signal.aborted)setConnections(value);},10000,!!channels,channels);
 if(!client)return <><PageHeader title="Inbox WhatsApp"/><Notice>Demonstração visual sem conversas reais. Entre em um workspace para conectar sua conta.</Notice></>;
 if(channelsLoaded&&loaded&&!error&&!search&&!senderFilter&&!connections.length&&!items.length)return <div className="whatsapp-empty-center"><EmptyState icon="MessageSquare" title="WhatsApp não configurado" description="Conecte um número em Configurações › WhatsApp para começar a receber e responder por aqui.">{canManage&&<LinkButton href="/settings/whatsapp" variant="primary">Conectar WhatsApp</LinkButton>}</EmptyState></div>;
 const open=!!selected,title=lead?.name??thread?.conversation.identity.phone??thread?.conversation.identity.externalId??'';
 return <><PageHeader title="Inbox WhatsApp" description="Conversas e estados reais dos seus remetentes." actions={<><LinkButton href="/settings/whatsapp">Conexões</LinkButton><Button disabled={busy} onClick={()=>act(async()=>{const token=++listGeneration.current;const result=await client.listConversations({search,...(senderFilter?{senderId:senderFilter}:{})});if(token===listGeneration.current){setItems(result.items);setCursor(result.nextCursor);setLoaded(true);}await refreshThread();})}>Atualizar</Button></>}/>
 {error&&<p role="alert" className="error-bar">{error}</p>}
 <div className={`inbox-layout whatsapp-inbox${open?' has-selection':''}`}><aside className="inbox-sidebar"><div className="whatsapp-list-tools"><form className="inbox-search" onSubmit={e=>{e.preventDefault();setSearch(query);}}><input aria-label="Buscar conversas por telefone ou identificador" placeholder="Telefone ou identificador…" value={query} onChange={e=>setQuery(e.target.value)} maxLength={200}/><Button>Buscar</Button></form><SelectField aria-label="Remetente" value={senderFilter} onChange={e=>{setSenderFilter(e.target.value);setSelected('');setThread(null);}}><option value="">Todos os remetentes</option>{connections.flatMap(c=>c.senders.map(s=><option key={s.id} value={s.id}>{c.name} · {s.address??s.externalId}</option>))}</SelectField></div>
 <div className="whatsapp-list" aria-label="Conversas">
 {!loaded&&!error&&<p role="status" className="panel-pad">Consultando conversas…</p>}{loaded&&!items.length&&<p className="thread-empty">Nenhuma conversa encontrada. As respostas chegam após validar o webhook do seu remetente.</p>}
 {items.map(v=>{const name=s.leads.find(l=>l.id===v.leadId)?.name??v.identity.phone??v.identity.externalId;return <button className={`whatsapp-thread ${selected===v.id?'selected':''}`} key={v.id} aria-pressed={selected===v.id} onClick={()=>{setSelected(v.id);setReconcile('');}}><span className="whatsapp-avatar" aria-hidden="true">{avatar(name)}</span><span className="whatsapp-thread-text"><span className="whatsapp-thread-top"><strong>{name}</strong><small>{v.lastMessageAt?listTime(v.lastMessageAt):''}</small></span><span className="whatsapp-thread-top"><small>{v.identity.phone??'Identidade opaca · sem telefone informado'}</small>{v.unread>0&&<span className="whatsapp-unread" aria-label={v.unread+' não lidas'}>{v.unread}</span>}</span></span></button>;})}
 {nextCursor&&<div className="panel-pad"><Button disabled={busy} onClick={()=>act(async()=>{const token=listGeneration.current;const page=await client.listConversations({search,cursor:nextCursor,...(senderFilter?{senderId:senderFilter}:{})});if(token===listGeneration.current){setItems(old=>[...old,...page.items.filter(v=>!old.some(x=>x.id===v.id))]);setCursor(page.nextCursor);}})}>Mais conversas</Button></div>}
 </div></aside><section className="inbox-detail">
 {!selected?<EmptyState icon="MessageSquare" title="Selecione uma conversa" description="O histórico pode existir mesmo sem empresa vinculada ou telefone informado pelo provedor."/>:!thread||thread.conversation.id!==selected?<><div className="whatsapp-conversation-header"><IconButton icon="ArrowLeft" label="Voltar às conversas" className="whatsapp-back" onClick={()=>{setSelected('');setThread(null);}}/></div><p className="panel-pad" role="status">Carregando histórico…</p></>:<div className="whatsapp-conversation" key={thread.conversation.id}>
 <header className="whatsapp-conversation-header"><IconButton icon="ArrowLeft" label="Voltar às conversas" className="whatsapp-back" onClick={()=>{setSelected('');setThread(null);}}/><span className="whatsapp-avatar" aria-hidden="true">{avatar(title)}</span><div className="whatsapp-conversation-title"><h2>{title}</h2><small>{lead?'Empresa vinculada: '+lead.name:'Sem empresa vinculada'} · {thread.conversation.identity.phone??thread.conversation.identity.externalId}</small></div><Badge>{connection?.name??'Remetente'}</Badge>
  <Button disabled={busy||!thread.messages.length||thread.conversation.unread===0} title="Marcar mensagens exibidas como lidas" onClick={()=>act(async()=>{await client.markRead(thread.conversation.id,thread.messages.at(-1)!.id);await refreshThread();})}>Marcar como lidas</Button>
  {canManage&&<IconButton icon="Settings" label="Vínculo, autorização e bloqueio do contato" onClick={()=>setManage(true)}/>}</header>
 <WhatsappHistory messages={thread.messages} hasOlder={!!thread.nextCursor} onReconcile={canManage&&connection?.provider!=='twilio'?setReconcile:undefined} onOlder={async()=>{const id=thread.conversation.id,cursor=thread.nextCursor;if(!cursor)return;const page=await client.readConversation(id,cursor);if(selectedRef.current===id)setThread(old=>old&&old.conversation.id===id&&old.nextCursor===cursor?prependOlder(old,page):old);}}/>
 <div className="whatsapp-sdr-dock"><SdrConversationControls conversationId={thread.conversation.id} onSent={refreshThread}/></div>
 {connection?.provider==='twilio'?<div className="panel-pad"><Notice>Conexão Twilio aposentada. Este histórico é somente para leitura.</Notice></div>:<WhatsappReply key={thread.conversation.id+(draft?.conversationId===thread.conversation.id?':draft':'')} initialText={draft?.conversationId===thread.conversation.id?draft.text:''} capabilities={sender?.capabilities} conversationId={thread.conversation.id} client={client} templates={templates} onQueued={refreshThread}/>}
 {manage&&canManage&&<Modal title="Contato desta conversa" onClose={()=>setManage(false)}><ConversationActions open conversation={thread.conversation} client={client} onSaved={refreshThread}/></Modal>}
 </div>}
 </section></div>{reconcile&&<ReconciliationReview messageId={reconcile} client={client} onClose={()=>setReconcile('')} onSaved={refreshThread}/>}
 </>;
}
