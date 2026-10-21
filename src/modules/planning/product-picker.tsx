"use client";
import {useEffect,useState} from 'react';
import {useContextClient} from '@/client/workspace-provider';
import type {ContextState} from '@/domain/products';
import {Field} from '@/components/ui/primitives';
export function useApprovedPlanningContext(){
 const client=useContextClient(),[context,setContext]=useState<ContextState|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;client?.get().then(data=>{if(live)setContext(data);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[client]);return {context,error};
}
export function ProductPicker({context,value,onChange}:{context:ContextState|null;value:string;onChange:(value:string)=>void}){
 return <Field label="Produto ou serviço" help="A IA usa apenas a versão aprovada do produto selecionado."><select value={value} onChange={e=>onChange(e.target.value)}><option value="">Contexto geral da empresa</option>{context?.products.filter(p=>p.approved&&!p.archived).map(p=><option key={p.id} value={p.id}>{p.approved!.name} · v{p.approved!.version}</option>)}</select></Field>;
}
