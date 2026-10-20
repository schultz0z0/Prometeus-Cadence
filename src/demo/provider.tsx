'use client';
import {createContext,useContext,useEffect,useState,useSyncExternalStore,useCallback} from 'react';
import {createDemoRepository} from './repository';
import {decodeDemoState,STORAGE_KEY} from './storage';
import type {DemoRepository} from '../domain/repository';
import {Button} from '@/components/ui/primitives';
const RepositoryContext=createContext<DemoRepository|null>(null);
const ToastContext=createContext<(message:string)=>void>(()=>{});
export function DemoProvider({children}:{children:React.ReactNode}){const[repo,setRepo]=useState(()=>createDemoRepository());const[ready,setReady]=useState(false);const[error,setError]=useState('');const[toast,setToast]=useState('');
 useEffect(()=>{let decoded;try{decoded=decodeDemoState(localStorage.getItem(STORAGE_KEY));}catch{decoded={ok:false as const,reason:'O navegador não permitiu acessar o armazenamento local.'};}if(decoded.ok){setRepo(createDemoRepository(decoded.value,s=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(s));}));}else setError(decoded.reason);setReady(true);},[]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(t);},[toast]);
 const notify=useCallback((m:string)=>setToast(m),[]);
 return <RepositoryContext value={repo}><ToastContext value={notify}>{error&&<div className="error-bar" role="alert">{error} Seus dados não foram sobrescritos. <Button onClick={()=>{try{localStorage.removeItem(STORAGE_KEY);location.reload();}catch{setError('Não foi possível restaurar. Verifique o armazenamento do navegador.');}}}>Restaurar demonstração</Button></div>}{ready?children:<div className="loading-screen">Carregando seu workspace…</div>}{toast&&<div className="toast" role="status">{toast}</div>}</ToastContext></RepositoryContext>;
}
export function useRepository(){const r=useContext(RepositoryContext);if(!r)throw Error('DemoProvider ausente');return r;}
export function useDemo(){const r=useRepository();return useSyncExternalStore(r.subscribe,r.getSnapshot,r.getSnapshot);}
export function useNotify(){return useContext(ToastContext);}
export function useAction(){const notify=useNotify();return (fn:()=>void,success?:string)=>{try{fn();if(success)notify(success);return true;}catch(e){notify(e instanceof Error?`Não foi possível salvar: ${e.message}`:'Não foi possível salvar os dados locais.');return false;}};}
