import type {Review,MessageState} from '../domain/whatsapp.ts';
export type MessagingFlowState<T>={kind:'editing'|'preparing'}|{kind:'reviewing'|'blocked'|'confirming';review:Review<T>}|{kind:'sent'};
export function createMessagingFlow<T=unknown>(initial:string){
 let fingerprint=initial,epoch=0,state:MessagingFlowState<T>={kind:'editing'};const listeners=new Set<()=>void>();
 function set(next:MessagingFlowState<T>){state=next;listeners.forEach(fn=>fn());}
 return {
  current:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
  edit(next:string){if(next!==fingerprint){fingerprint=next;epoch++;set({kind:'editing'});}},
  begin(){epoch++;set({kind:'preparing'});return epoch;},
  accept(ticket:number,review:Review<T>){if(ticket!==epoch)return false;set({kind:review.blockers.length?'blocked':'reviewing',review});return true;},
  confirm(){if(state.kind!=='reviewing'||Date.parse(state.review.expiresAt)<=Date.now()||!Number.isFinite(Date.parse(state.review.expiresAt)))return null;const review=state.review;set({kind:'confirming',review});return review;},
  finish(ticket:number){if(ticket!==epoch)return false;set({kind:'sent'});return true;},
  reset(){epoch++;set({kind:'editing'});},
 };
}
export const canBlindRetry=(state:MessageState)=>state==='pending';
