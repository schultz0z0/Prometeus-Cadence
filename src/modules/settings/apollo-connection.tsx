"use client";
import {useCallback,useEffect,useState} from 'react';
import {useIdentity} from '@/client/workspace-provider';
import type {ConnectionView} from '@/domain/connector-capabilities';
import {Button,Field,Modal,Notice} from '@/components/ui/primitives';
import {Icon} from '@/components/ui/icon';
// Calls carry the workspace they were made for; the key goes only to the credentials endpoint and never comes back.
export function useConnectorApi(){
 const ws=useIdentity()?.activeWorkspaceId;
 return useCallback(async<T,>(path:string,body?:unknown):Promise<T>=>{
  if(!ws)throw Error('Entre na sua conta para conectar apps.');
  let r:Response;
  try{r=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{'x-cadence-workspace':ws,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch{throw Error('Sem conexão com o servidor. Tente de novo.');}
  const data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.message??'Não foi possível concluir.');return data as T;
 },[ws]);
}
export function useConnections(){
 const api=useConnectorApi(),[items,setItems]=useState<ConnectionView[]|null>(null),[error,setError]=useState('');
 const load=useCallback(()=>{setError('');api<{connections:ConnectionView[]}>('/api/integrations?view=connections').then(r=>setItems(r.connections)).catch(e=>setError(e.message));},[api]);
 useEffect(load,[load]);
 return{items,error,load};
}
export function ApolloConnection(){
 const identity=useIdentity(),canManage=['owner','admin'].includes(identity?.workspaces.find(w=>w.id===identity.activeWorkspaceId)?.role??'');
 const api=useConnectorApi(),{items,error:loadError,load}=useConnections(),[key,setKey]=useState(''),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[replacing,setReplacing]=useState(false),[confirm,setConfirm]=useState(false);
 const live=items?.find(c=>c.kind==='apollo')??null;
 async function connect(){
  if(key.trim().length<20)return setError('Cole a chave de API completa do Apollo.');
  setBusy(true);setError('');setMessage('');
  try{
   // Two steps: the key becomes a single-use reference, then the server verifies it with Apollo and saves it encrypted.
   const ref=await api<{credentialRef:string}>('/api/integrations/credentials',{kind:'apollo',secret:key.trim()});
   setKey('');
   await api('/api/integrations',{action:'connect',input:{kind:'apollo',name:'Conta Apollo',credentialRef:ref.credentialRef,expectedRevision:live?.revision??0}});
   setReplacing(false);setMessage('Apollo conectado. As buscas Apollo passam a usar a sua conta e os seus créditos.');load();
  }catch(e){setError((e as Error).message+' A chave não ficou guardada: cole-a de novo para tentar.');}finally{setBusy(false);}
 }
 async function disconnect(){
  if(!live)return;setBusy(true);setError('');setMessage('');
  try{await api(`/api/integrations/${live.id}/disconnect`,{expectedRevision:live.revision});setMessage('Apollo desconectado. Buscas já confirmadas que ainda não rodaram não usarão mais a chave.');load();}
  catch(e){setError((e as Error).message);load();}finally{setBusy(false);}
 }
 const form=<form onSubmit={e=>{e.preventDefault();void connect();}}><Field label="Chave de API"><div className="apollo-key-row"><input type={show?'text':'password'} autoComplete="off" spellCheck={false} value={key} maxLength={200} disabled={busy} onChange={e=>{setKey(e.target.value);setError('');}} placeholder="Cole a chave aqui"/><button type="button" className="icon-btn" aria-label="Mostrar chave" aria-pressed={show} onClick={()=>setShow(s=>!s)}><Icon name={show?'EyeOff':'Eye'} size={16}/></button></div></Field>
  <p className="muted">Gere a chave em Apollo › Settings › Integrations › API. Ela é conferida no Apollo, guardada cifrada e nunca é exibida de novo.</p>
  <div className="form-actions">{replacing&&<Button type="button" disabled={busy} onClick={()=>{setReplacing(false);setKey('');}}>Cancelar</Button>}<Button type="submit" variant="primary" disabled={busy||!key.trim()}>{busy?'Conectando…':'Conectar'}</Button></div></form>;
 return <>
  <section className="reference-panel"><header><Icon name="Target"/><h2>Chave de API</h2></header><div className="reference-panel-body">
   {loadError?<Notice tone="error">{loadError} <button type="button" className="text-button" onClick={load}>Tentar de novo</button></Notice>
   :!items?<p role="status">Consultando a conexão…</p>
   :live&&!replacing?<div className="apollo-connected"><span className="badge green"><Icon name="CheckCircle2" size={12}/>Conectado</span><p>Conta Apollo conferida em {live.verifiedAt?new Date(live.verifiedAt).toLocaleString('pt-BR'):'—'}. As buscas Apollo usam a sua chave.</p>
     <div className="form-actions">{canManage&&<><Button type="button" disabled={busy} onClick={()=>{setReplacing(true);setMessage('');}}>Trocar chave</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>setConfirm(true)}>Desconectar</Button></>}</div></div>
   :canManage?form:<p className="muted">Somente proprietário ou administrador conecta o Apollo.</p>}
   {error&&<div role="alert"><Notice tone="error">{error}</Notice></div>}
   <p className="sr-only" role="status">{message}</p>{message&&<Notice tone="success">{message}</Notice>}
  </div></section>
  {confirm&&<Modal title="Desconectar o Apollo?" onClose={()=>setConfirm(false)}><div className="stack"><p>A chave é apagada. Buscas Apollo já confirmadas que ainda não rodaram falham em vez de usar a chave.</p><div className="form-actions"><Button type="button" onClick={()=>setConfirm(false)}>Cancelar</Button><Button type="button" variant="danger" onClick={()=>{setConfirm(false);void disconnect();}}>Desconectar</Button></div></div></Modal>}
 </>;
}
