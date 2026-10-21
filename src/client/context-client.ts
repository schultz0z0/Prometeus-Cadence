import type {ContextState,ProductView,ProductProfile} from '../domain/products.ts';
import {createWorkspaceTransport,type WorkspaceTransportOptions} from './workspace-transport.ts';
export interface ProductSave{requestId?:string;id?:string;expectedRevision:number;action:'save-draft'|'approve'|'archive';profile?:ProductProfile;sourceJobId?:string}
export function createContextClient(options:WorkspaceTransportOptions){
 const api=createWorkspaceTransport(options),ids=new Map<string,string>(),flights=new Map<string,Promise<ProductView>>();
 return {
  get:()=>api.request<ContextState>('/api/context'),
  saveProduct(body:ProductSave){
   const key=JSON.stringify(body),old=flights.get(key);if(old)return old;
   let requestId=body.requestId??ids.get(key);if(!requestId){requestId=crypto.randomUUID();ids.set(key,requestId);}
   const promise=api.request<ProductView>('/api/context/products',{...body,requestId}).then(result=>{ids.delete(key);return result;}).catch(e=>{flights.delete(key);throw e;});flights.set(key,promise);return promise;
  },
  dispose(){api.dispose();ids.clear();flights.clear();},
 };
}
export type ContextClient=ReturnType<typeof createContextClient>;
