"use client";
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useIdentity} from '@/client/workspace-provider';
import {useDemo} from '@/demo/provider';
import {apiScopeLabels,apiScopes,MAX_API_KEYS,type ApiKeyView,type ApiScope} from '@/domain/api-credentials';
import {agentEvents,MAX_DESTINATIONS,webhookEventLabels,webhookEvents,type DeliveryView,type WebhookEvent,type WebhookView} from '@/domain/integration-delivery';
import {Badge,Button,Field,IconButton,Modal,Notice} from '@/components/ui/primitives';
import {Icon} from '@/components/ui/icon';
type Draft={name:string;url:string;secret:string;events:WebhookEvent[];mode:'all'|'specific';ids:string[]};
const empty:Draft={name:'',url:'',secret:'',events:['lead.created','lead.qualified','lead.connected'],mode:'all',ids:[]};
const attentionText:Record<string,string>={unauthorized:'O destino recusou a credencial. Confira o segredo e a autenticação do outro lado.',gone:'O destino informou que o endereço não existe mais.',address:'O endereço deixou de ser público ou não resolve.',redirect:'O destino respondeu com redirecionamento, que não é seguido. Use a URL final.'};
const stateText:Record<DeliveryView['state'],string>={pending:'Na fila',delivering:'Enviando',delivered:'Entregue',failed:'Falhou',held:'Aguardando correção',cancelled:'Cancelada'};
function useApi(){
 const identity=useIdentity(),ws=identity?.activeWorkspaceId;
 return useCallback(async<T,>(path:string,body?:unknown):Promise<T>=>{
  if(!ws)throw Error('Entre na sua conta para gerenciar webhooks.');
  let r:Response;
  try{r=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{'x-cadence-workspace':ws,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch{throw Error('Sem conexão com o servidor. Tente de novo.');}
  const data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.message??'Não foi possível concluir.');return data as T;
 },[ws]);
}
function WebhookForm({initial,editing,onClose,onSaved}:{initial:Draft;editing:WebhookView|null;onClose:()=>void;onSaved:()=>void}){
 const api=useApi(),{lists}=useDemo(),[d,setD]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[requestId]=useState(()=>crypto.randomUUID());
 const set=(patch:Partial<Draft>)=>{setD(v=>({...v,...patch}));setError('');};
 const toggle=(e:WebhookEvent)=>set({events:d.events.includes(e)?d.events.filter(x=>x!==e):[...d.events,e]});
 async function save(){
  if(!d.name.trim()||!d.url.trim())return setError('Nome e URL são obrigatórios.');
  if(!d.events.length)return setError('Selecione pelo menos um evento.');
  if(d.mode==='specific'&&!d.ids.length)return setError("Escolha pelo menos uma lista (ou marque 'Todas as listas').");
  const input={name:d.name.trim(),url:d.url.trim(),events:d.events,lists:d.mode==='all'?{mode:'all'}:{mode:'specific',ids:d.ids},expectedRevision:editing?.revision??0,...(d.secret.trim()?{secret:d.secret.trim()}:{})};
  setBusy(true);
  try{
   // The server reviews the address (public DNS/IP), lists and limit before anything is saved.
   const review=await api<{token:string;blockers:string[]}>('/api/integrations',{action:'prepare',id:editing?.id??null,input});
   if(review.blockers.length){setError(review.blockers[0]);return;}
   await api('/api/integrations',{action:'confirm',id:editing?.id??null,input,token:review.token,requestId});onSaved();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <Modal title={editing?'Editar webhook':'Novo webhook'} description="Um POST JSON por evento. Com segredo, o cabeçalho X-Webhook-Signature traz o HMAC SHA-256 do corpo." onClose={()=>{if(!busy)onClose();}} className="webhook-dialog">
  <div className="stack">
   <Field label="Nome"><input data-autofocus value={d.name} maxLength={80} onChange={e=>set({name:e.target.value})} placeholder="Ex.: Meu CRM, n8n, Zapier"/></Field>
   <Field label="URL" help="Precisa ser um endereço público em HTTPS ou HTTP."><input value={d.url} maxLength={2000} inputMode="url" onChange={e=>set({url:e.target.value})} placeholder="https://exemplo.com/webhook"/></Field>
   <Field label="Segredo" help={editing?.secretConfigured?'Já existe um segredo. Deixe vazio para mantê-lo, ou cole outro para trocar.':'Assina cada entrega, pro sistema que recebe confirmar que o POST veio do Prometeus. Se você já tem um do outro lado, cole aqui.'}><input type="password" autoComplete="off" value={d.secret} maxLength={200} onChange={e=>set({secret:e.target.value})} placeholder={editing?.secretConfigured?'••••••••':'Opcional (mínimo de 16 caracteres)'}/></Field>
   <fieldset className="webhook-events"><legend>Eventos</legend>{webhookEvents.map(e=><label key={e}><input type="checkbox" checked={d.events.includes(e)} onChange={()=>toggle(e)}/><span><code>{e}</code>{webhookEventLabels[e]}</span></label>)}</fieldset>
   <fieldset className="webhook-events disabled"><legend>Agente de IA</legend><p>O Agente SDR ainda não existe no Prometeus, então estes eventos não são enviados.</p>{agentEvents.map(([code,label])=><label key={code}><input type="checkbox" disabled checked={false} onChange={()=>{}}/><span><code>{code}</code>{label}</span></label>)}</fieldset>
   <fieldset className="webhook-events"><legend>Listas</legend>
    <label><input type="radio" name="webhook-lists" checked={d.mode==='all'} onChange={()=>set({mode:'all'})}/><span>Todas as listas</span></label>
    <label><input type="radio" name="webhook-lists" checked={d.mode==='specific'} onChange={()=>set({mode:'specific'})}/><span>Listas específicas</span></label>
    {d.mode==='specific'&&<div className="webhook-list-picks">{lists.length?lists.map(l=><label key={l.id}><input type="checkbox" checked={d.ids.includes(l.id)} onChange={()=>set({ids:d.ids.includes(l.id)?d.ids.filter(x=>x!==l.id):[...d.ids,l.id]})}/><span>{l.name}</span></label>):<small>Nenhuma lista ainda.</small>}</div>}
   </fieldset>
   {error&&<Notice tone="error">{error}</Notice>}
   <div className="form-actions"><Button type="button" disabled={busy} onClick={onClose}>Cancelar</Button><Button type="button" variant="primary" disabled={busy} onClick={()=>void save()}>{busy?'Salvando…':editing?'Salvar':'Criar webhook'}</Button></div>
  </div>
 </Modal>;
}
function Deliveries({id}:{id:string}){
 const api=useApi(),[items,setItems]=useState<DeliveryView[]|null>(null),[error,setError]=useState('');
 const [tick,setTick]=useState(0);
 useEffect(()=>{let live=true;api<{deliveries:DeliveryView[]}>(`/api/integrations/${id}/deliveries`).then(r=>{if(live)setItems(r.deliveries);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[api,id,tick]);
 // Queued or in-flight deliveries refresh on their own until they settle.
 useEffect(()=>{if(!items?.some(i=>i.state==='pending'||i.state==='delivering'))return;const t=setTimeout(()=>setTick(n=>n+1),5000);return()=>clearTimeout(t);},[items]);
 return <div className="webhook-history"><h4><Icon name="Clock" size={13}/>Últimas entregas</h4>
  {error?<p role="alert">{error}</p>:!items?<p role="status">Carregando entregas…</p>:!items.length?<p>Nenhuma entrega ainda.</p>:
   <ul>{items.map(i=><li key={i.id} className={i.state}><span className="dot"/><code>{i.eventType}</code><span>{stateText[i.state]}{i.lastStatus?` · HTTP ${i.lastStatus}`:''}{i.attempts>1?` · ${i.attempts} tentativas`:''}</span>{i.lastError&&<small title={i.lastError}>{i.lastError}</small>}<time>{new Date(i.createdAt).toLocaleString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</time></li>)}</ul>}
 </div>;
}
// Shown once, outside any live region (screen readers must not announce it); focus moves here when it appears.
function SecretBanner({value,onClose,label='Segredo gerado'}:{value:string;onClose:()=>void;label?:string}){
 const ref=useRef<HTMLDivElement>(null);useEffect(()=>{ref.current?.focus();},[]);
 return <div className="webhook-secret shown" tabIndex={-1} ref={ref} role="group" aria-label={label}><span>{label}. Copie agora: ele aparece uma vez só.</span><code>{value}</code><Button variant="compact" onClick={()=>void navigator.clipboard?.writeText(value)}>Copiar</Button><Button variant="compact ghost" onClick={onClose}>Fechar</Button></div>;
}
export function WebhookSettings(){
 const api=useApi(),{lists}=useDemo(),[items,setItems]=useState<WebhookView[]|null>(null),[error,setError]=useState(''),[form,setForm]=useState<{initial:Draft;editing:WebhookView|null}|null>(null),[open,setOpen]=useState(''),[busy,setBusy]=useState(''),[secrets,setSecrets]=useState<Record<string,string>>({}),[message,setMessage]=useState(''),[confirmDelete,setConfirmDelete]=useState<WebhookView|null>(null),[rotate,setRotate]=useState<WebhookView|null>(null);
 const [keys,setKeys]=useState<ApiKeyView[]|null>(null);
 const load=useCallback(()=>{setError('');api<{webhooks:WebhookView[];keys:ApiKeyView[]}>('/api/integrations').then(r=>{setItems(r.webhooks);setKeys(r.keys);}).catch(e=>setError(e.message));},[api]);
 useEffect(load,[load]);
 const listName=(id:string)=>lists.find(l=>l.id===id)?.name??'Lista removida';
 async function act(w:WebhookView,action:string){
  setBusy(w.id+action);setMessage('');
  try{const r=await api<{webhook:WebhookView|null;secret?:string}>(`/api/integrations/${w.id}/action`,{action,expectedRevision:w.revision});
   if(r.secret)setSecrets(s=>({...s,[w.id]:r.secret!}));
   if(action==='test')setMessage('Teste colocado na fila. Acompanhe o resultado nas entregas.');
   if(action==='test')setOpen(w.id);load();
  }catch(e){setMessage((e as Error).message);load();}finally{setBusy('');}
 }
 return <div className="reference-settings"><h1>Webhooks e API</h1><p className="subtitle">Envie eventos do Prometeus para outros sistemas em tempo real. Conectar número de WhatsApp é em <Link href="/settings/whatsapp">WhatsApp</Link>.</p>
  <section className="reference-panel webhook-reference"><header><Icon name="Webhook"/><div className="grow"><h2>Webhooks de saída</h2><p>Um POST com o lead a cada evento, em até {MAX_DESTINATIONS} destinos.</p></div>
   <Button variant="primary" icon="Plus" disabled={!items||items.length>=MAX_DESTINATIONS} onClick={()=>setForm({initial:empty,editing:null})}>Novo webhook</Button></header>
   {message&&<div className="webhook-message"><Notice>{message}</Notice></div>}
   {error?<div className="reference-empty"><Icon name="AlertCircle" size={28}/><strong>Não foi possível carregar os webhooks</strong><p>{error}</p><Button onClick={load}>Tentar de novo</Button></div>
   :!items?<div className="reference-empty" role="status"><p>Carregando webhooks…</p></div>
   :!items.length?<div className="reference-empty"><Icon name="Webhook" size={28}/><strong>Nenhum webhook</strong><p>Crie um pra avisar seu CRM, n8n ou Zapier quando um lead entrar, for qualificado ou responder.</p></div>
   :<ul className="webhook-items">{items.map(w=><li key={w.id}>
     <div className="webhook-row"><div className="webhook-main">
      <div className="webhook-title"><strong>{w.name}</strong>{!w.active&&<Badge>Pausado</Badge>}{w.consecutiveFailures>0&&<Badge tone="red"><Icon name="AlertCircle" size={11}/>{w.consecutiveFailures} {w.consecutiveFailures===1?'falha seguida':'falhas seguidas'}</Badge>}</div>
      <span className="webhook-url" title={w.url}>{w.url}</span>
      <div className="webhook-badges">{w.events.map(e=><Badge key={e} tone="orange">{webhookEventLabels[e]}</Badge>)}<Badge>{w.listIds?.length?(w.listIds.length===1?listName(w.listIds[0]):`${w.listIds.length} listas`):'Todas as listas'}</Badge>{w.deliveries>0&&<span className="webhook-count"><Icon name="Send" size={11}/>{w.deliveries} entregas</span>}</div>
     </div><div className="webhook-actions">
      <input type="checkbox" role="switch" className="webhook-switch" aria-label={(w.active?'Pausar ':'Ativar ')+w.name} checked={w.active} disabled={!!busy} onChange={()=>void act(w,w.active?'pause':'activate')}/>
      <IconButton icon="Play" label={'Testar '+w.name} disabled={!!busy||!w.active} onClick={()=>void act(w,'test')}/>
      <IconButton icon="History" label={'Entregas de '+w.name} onClick={()=>setOpen(o=>o===w.id?'':w.id)}/>
      <IconButton icon="Pencil" label={'Editar '+w.name} disabled={!!busy} onClick={()=>setForm({initial:{name:w.name,url:w.url,secret:'',events:w.events,mode:w.listIds?'specific':'all',ids:(w.listIds??[]).filter(id=>lists.some(l=>l.id===id))},editing:w})}/>
      <IconButton icon="Trash2" label={'Excluir '+w.name} disabled={!!busy} onClick={()=>setConfirmDelete(w)}/>
     </div></div>
     {(w.attention||w.consecutiveFailures>0)&&<div className="webhook-alert"><Icon name="AlertCircle" size={14}/><span>{w.attention?attentionText[w.attention]:w.lastSuccessAt?`Nenhuma entrega deu certo desde ${new Date(w.lastSuccessAt).toLocaleDateString('pt-BR')}.`:'Nenhuma entrega deu certo ainda.'} Confira a URL e se o sistema que recebe está no ar.</span>
      {w.attention&&<Button variant="compact" disabled={!!busy} onClick={()=>void act(w,'retry')}>Tentar de novo</Button>}<Button variant="compact ghost" onClick={()=>setOpen(w.id)}>Ver entregas</Button></div>}
     {!w.secretConfigured&&!secrets[w.id]&&<div className="webhook-secret"><Icon name="KeyRound" size={14}/><span>Sem segredo: o sistema que recebe não consegue confirmar a origem.</span><Button variant="compact" disabled={!!busy} onClick={()=>void act(w,'secret')}>Gerar segredo</Button></div>}
     {w.secretConfigured&&!secrets[w.id]&&<div className="webhook-secret muted"><Icon name="KeyRound" size={14}/><span>Segredo configurado.</span><Button variant="compact ghost" disabled={!!busy} onClick={()=>setRotate(w)}>Gerar novo</Button></div>}
     {secrets[w.id]&&<SecretBanner value={secrets[w.id]} onClose={()=>setSecrets(x=>{const n={...x};delete n[w.id];return n;})}/>}
     {open===w.id&&<Deliveries key={w.id+':'+w.revision+':'+w.deliveries} id={w.id}/>}
    </li>)}</ul>}
  </section>
  <ApiKeys keys={keys} onChanged={load} loadError={error}/>
  {form&&<WebhookForm initial={form.initial} editing={form.editing} onClose={()=>setForm(null)} onSaved={()=>{setForm(null);load();}}/>}
  {rotate&&<Modal title="Gerar um segredo novo?" description={rotate.name} onClose={()=>setRotate(null)}><div className="stack"><p>O segredo atual deixa de valer na hora: o sistema que recebe precisa do novo para conferir as próximas entregas.</p><div className="form-actions"><Button type="button" onClick={()=>setRotate(null)}>Cancelar</Button><Button type="button" variant="primary" onClick={()=>{const w=rotate;setRotate(null);void act(w,'secret');}}>Gerar novo</Button></div></div></Modal>}
  {confirmDelete&&<Modal title="Excluir este webhook?" description={confirmDelete.name} onClose={()=>setConfirmDelete(null)}><div className="stack"><p>As entregas pendentes são canceladas e o histórico deste destino é apagado.</p><div className="form-actions"><Button type="button" onClick={()=>setConfirmDelete(null)}>Cancelar</Button><Button type="button" variant="danger" onClick={()=>{const w=confirmDelete;setConfirmDelete(null);void act(w,'delete');}}>Excluir</Button></div></div></Modal>}
 </div>;
}
// Read-only API keys (own design: the reference shows no API keys). The token appears once, after creating or rotating.
function ApiKeys({keys,onChanged,loadError}:{keys:ApiKeyView[]|null;onChanged:()=>void;loadError:string}){
 const api=useApi(),[form,setForm]=useState(false),[name,setName]=useState(''),[scopes,setScopes]=useState<ApiScope[]>(['leads:read']),[busy,setBusy]=useState(false),[error,setError]=useState(''),[token,setToken]=useState<{value:string;label:string}|null>(null),[done,setDone]=useState(''),[confirm,setConfirm]=useState<{key:ApiKeyView;op:'rotate'|'revoke'}|null>(null);
 async function create(){
  if(!name.trim()||!scopes.length)return setError('Dê um nome e escolha pelo menos um escopo.');
  setBusy(true);setError('');
  try{const r=await api<{token:string}>('/api/integrations',{action:'create-key',input:{name:name.trim(),scopes}});setToken({value:r.token,label:'Chave criada'});setDone('');setForm(false);setName('');onChanged();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function run(key:ApiKeyView,op:'rotate'|'revoke'){
  setBusy(true);setError('');
  try{const r=await api<{token?:string}>(`/api/integrations/${key.id}/key-${op}`,{expectedRevision:key.revision});if(r.token)setToken({value:r.token,label:'Nova chave gerada'});setDone(op==='rotate'?'Chave anterior desativada.':'Chave revogada.');onChanged();}
  catch(e){setError((e as Error).message);onChanged();}finally{setBusy(false);}
 }
 const date=(v:string)=>new Date(v).toLocaleDateString('pt-BR');
 return <section className="reference-panel webhook-reference api-keys"><header><Icon name="KeyRound"/><div className="grow"><h2>API de leitura</h2><p>Leia leads e eventos de outros sistemas com <code>Authorization: Bearer</code>. Somente leitura, até 120 requisições por minuto por chave.</p></div>
  <Button variant="primary" icon="Plus" disabled={!keys||keys.length>=MAX_API_KEYS||busy} onClick={()=>{setForm(true);setError('');}}>Nova chave</Button></header>
  {token&&<div className="webhook-message"><SecretBanner value={token.value} label={token.label} onClose={()=>setToken(null)}/></div>}
  <p className="sr-only" role="status">{done}</p>
  {keys&&keys.length>=MAX_API_KEYS&&<div className="webhook-message"><Notice>Limite de {MAX_API_KEYS} chaves ativas. Revogue uma para criar outra.</Notice></div>}
  {error&&!form&&<div className="webhook-message"><Notice tone="error">{error}</Notice></div>}
  {loadError?null:!keys?<div className="reference-empty" role="status"><p>Carregando chaves…</p></div>
  :!keys.length?<div className="reference-empty"><Icon name="KeyRound" size={28}/><strong>Nenhuma chave</strong><p>Crie uma para consultar <code>GET /api/v1/leads</code> e <code>GET /api/v1/events</code> do seu CRM ou automação.</p></div>
  :<ul className="webhook-items">{keys.map(k=><li key={k.id}><div className="webhook-row"><div className="webhook-main">
    <div className="webhook-title"><strong>{k.name}</strong></div><span className="webhook-url">{k.prefix}…</span>
    <div className="webhook-badges">{k.scopes.map(sc=><Badge key={sc} tone="orange">{apiScopeLabels[sc]}</Badge>)}<span className="webhook-count">Criada em {date(k.createdAt)} · {k.lastUsedAt?'último uso '+date(k.lastUsedAt):'nunca usada'}</span></div>
   </div><div className="webhook-actions"><Button variant="compact" disabled={busy} onClick={()=>setConfirm({key:k,op:'rotate'})}>Gerar nova</Button><Button variant="compact ghost" disabled={busy} onClick={()=>setConfirm({key:k,op:'revoke'})}>Revogar</Button></div></div></li>)}</ul>}
  {form&&<Modal title="Nova chave de API" description="A chave aparece uma vez só. Guarde no sistema que vai consultar a API." onClose={()=>{if(!busy)setForm(false);}}><div className="stack">
   <Field label="Nome"><input data-autofocus value={name} maxLength={60} onChange={e=>{setName(e.target.value);setError('');}} placeholder="Ex.: n8n, planilha, CRM"/></Field>
   <fieldset className="webhook-events"><legend>Escopos</legend>{scopes.includes('events:read')&&<p>Com <code>events:read</code>, os eventos de leads ficam guardados por 30 dias para a consulta, enquanto a chave estiver em uso.</p>}{apiScopes.map(sc=><label key={sc}><input type="checkbox" checked={scopes.includes(sc)} onChange={()=>setScopes(v=>v.includes(sc)?v.filter(x=>x!==sc):[...v,sc])}/><span><code>{sc}</code>{apiScopeLabels[sc]}</span></label>)}</fieldset>
   {error&&<Notice tone="error">{error}</Notice>}
   <div className="form-actions"><Button type="button" disabled={busy} onClick={()=>setForm(false)}>Cancelar</Button><Button type="button" variant="primary" disabled={busy} onClick={()=>void create()}>{busy?'Criando…':'Criar chave'}</Button></div>
  </div></Modal>}
  {confirm&&<Modal title={confirm.op==='rotate'?'Gerar uma chave nova?':'Revogar esta chave?'} description={confirm.key.name} onClose={()=>setConfirm(null)}><div className="stack">
   <p>{confirm.op==='rotate'?'A chave atual para de funcionar na hora. Atualize o sistema que consulta a API com a nova.':'A chave para de funcionar na hora e não pode ser reativada.'}</p>
   <div className="form-actions"><Button type="button" onClick={()=>setConfirm(null)}>Cancelar</Button><Button type="button" variant={confirm.op==='rotate'?'primary':'danger'} onClick={()=>{const c=confirm;setConfirm(null);void run(c.key,c.op);}}>{confirm.op==='rotate'?'Gerar nova':'Revogar'}</Button></div>
  </div></Modal>}
 </section>;
}
