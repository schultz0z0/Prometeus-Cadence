import type {ConnectionView,TemplateView,MessageView,OutboundContent,PreparedSend,Review} from '../domain/whatsapp.ts';
import type {SaveConnectionInput,SenderLimitsInput} from '../server/channels/schemas.ts';
import type {MessagingLimitsView} from '../server/channels/limits.ts';
import type {OpenwaConnectionView,OpenwaQrView} from '../domain/openwa.ts';
import {createWorkspaceTransport,type WorkspaceTransportOptions} from './workspace-transport.ts';
export interface ChannelTestInput {senderId:string;phone:string;content:OutboundContent;consent?:{source:string;occurredAt:string;evidence:string}}
export interface TestSendReview {connectionId:string;input:ChannelTestInput;review:Review<PreparedSend>&{preview:string}}

// Retain the same command identity for a retried, explicitly reviewed object.
// Weak keys avoid retaining credential forms after they have been closed.
export function createReviewedCommands(api:ReturnType<typeof createWorkspaceTransport>){
 let commands=new WeakMap<object,{id:string;promise?:Promise<unknown>}>();
 return {
  run<T>(key:object,path:string,body:Record<string,unknown>):Promise<T>{
   let entry=commands.get(key);if(!entry){entry={id:crypto.randomUUID()};commands.set(key,entry);}
   if(entry.promise)return entry.promise as Promise<T>;
   const current=entry;
   const promise=api.request<T>(path,{...body,requestId:current.id}).catch(e=>{current.promise=undefined;throw e;});
   current.promise=promise;return promise;
  },
  clear(){commands=new WeakMap();},
 };
}
export function createChannelClient(options:WorkspaceTransportOptions){
 const api=createWorkspaceTransport(options),commands=createReviewedCommands(api);
 const path=(id:string,action:string)=>'/api/channels/'+encodeURIComponent(id)+'/'+action;
 const action=<T>(id:string,name:string,expectedRevision:number)=>api.request<T>(path(id,name),{expectedRevision,requestId:crypto.randomUUID()});
 return {
  list:()=>api.request<ConnectionView[]>('/api/channels'),
  createOpenwa:(input:{name:string;expectedRevision:0})=>commands.run<OpenwaConnectionView>(input,'/api/channels/openwa',input),
  openwaStatus:(id:string)=>api.request<OpenwaConnectionView>(path(id,'openwa-status')),
  openwaQr:(id:string,revision:number)=>api.request<OpenwaQrView>(path(id,'openwa-qr')+'?revision='+encodeURIComponent(revision)),
  reconnectOpenwa:(id:string,input:{expectedRevision:number})=>commands.run<OpenwaConnectionView>(input,path(id,'openwa-reconnect'),input),
  disconnectOpenwa:(id:string,input:{expectedRevision:number})=>commands.run<OpenwaConnectionView>(input,path(id,'openwa-disconnect'),input),
  save:(input:Omit<SaveConnectionInput,'requestId'>)=>commands.run<ConnectionView>(input,'/api/channels',input),
  verify:(id:string,revision:number)=>action<ConnectionView>(id,'verify',revision),
  syncTemplates:(id:string,revision:number)=>action<TemplateView[]>(id,'sync-templates',revision),
  disconnect:(id:string,revision:number)=>action<ConnectionView>(id,'disconnect',revision),
  getVerifyToken:(id:string,revision:number)=>action<{verifyToken:string}>(id,'verify-token',revision),
  templates:(id:string)=>api.request<TemplateView[]>('/api/messaging/templates?connectionId='+encodeURIComponent(id)),
  limits:()=>api.request<MessagingLimitsView>('/api/messaging/limits'),
  setLimits:(connectionId:string,input:Omit<SenderLimitsInput,'requestId'>)=>commands.run<void>(input,path(connectionId,'limits'),input),
  async prepareTest(connectionId:string,input:ChannelTestInput):Promise<TestSendReview>{
   const copy=structuredClone(input);return {connectionId,input:copy,review:await api.request(path(connectionId,'test-prepare'),copy)};
  },
  confirmTest:(prepared:TestSendReview)=>commands.run<MessageView>(prepared,path(prepared.connectionId,'test-confirm'),{...prepared.input,reviewToken:prepared.review.token}),
  dispose(){api.dispose();commands.clear();},
 };
}
export type ChannelClient=ReturnType<typeof createChannelClient>;
