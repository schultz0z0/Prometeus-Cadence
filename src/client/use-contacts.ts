"use client";
import {useEffect,useRef,useState} from 'react';
import {createWorkspaceTransport} from './workspace-transport';
import {useIdentity,useWorkspaceRevision} from './workspace-provider';
import {useLiveRefresh} from './use-live-refresh';
import type {ContactsPage,ContactsQuery} from '../domain/contacts-query';
import {currentContactsPage} from './contacts-read-state';
export function useContacts(query:ContactsQuery){
 const identity=useIdentity(),workspaceId=identity?.activeWorkspaceId,revision=useWorkspaceRevision(),key=new URLSearchParams(Object.entries(query).filter(([,v])=>v!==undefined&&v!=='').map(([k,v])=>[k,String(v)])).toString();
 const [result,setResult]=useState<{key:string;data:ContactsPage}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),reload=useRef<(()=>Promise<void>)|null>(null);
 const scopeKey=(workspaceId??'')+':'+key;
 useEffect(()=>{
  if(!workspaceId)return;const api=createWorkspaceTransport({workspaceId});let current=true;setLoading(true);setError('');
  const load=async()=>{try{const data=await api.request<ContactsPage>('/api/contacts?'+key);if(current){setResult({key:scopeKey,data});setError('');}}catch(e){if(current){setResult(null);setError((e as Error).message);}}finally{if(current)setLoading(false);}};
  reload.current=load;const timer=setTimeout(()=>void load(),200);
  return()=>{current=false;clearTimeout(timer);if(reload.current===load)reload.current=null;api.dispose();};
 },[workspaceId,key,revision]);
 useLiveRefresh(async signal=>{if(!signal.aborted)await reload.current?.();},15000,!!workspaceId,key);
 return {data:currentContactsPage(result,scopeKey,revision??0),error,loading,enabled:!!workspaceId,refresh:()=>void reload.current?.()};
}
