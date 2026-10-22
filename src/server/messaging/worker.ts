import 'server-only';
import {applyReceivedEvents} from '../channels/events.ts';
import {materializeDueMessages} from './outbox.ts';
import {claimDispatch} from './lease.ts';
import {dispatchOne} from './dispatch.ts';
import {runMailSyncTick} from '../mail/sync/worker.ts';
export async function runMessagingTick(deps:{now:()=>string;maxMessages:number;workspaceId?:string;messageId?:string;allowSync?:boolean;events?:typeof applyReceivedEvents;dispatch?:(lease:NonNullable<Awaited<ReturnType<typeof claimDispatch>>>)=>Promise<void>}):Promise<{events:number;materialized:number;dispatched:number}>{
 if(!Number.isInteger(deps.maxMessages)||deps.maxMessages<1||deps.maxMessages>100||!Number.isFinite(Date.parse(deps.now())))throw Error('Invalid messaging tick');
 if(deps.messageId&&(!deps.workspaceId||deps.maxMessages!==1))throw Error('One-message scope required');
 if(!deps.messageId&&deps.allowSync&&process.env.MAIL_SYNC_ENABLED==='true')await runMailSyncTick({now:deps.now(),workspaceId:deps.workspaceId,maxMailboxes:Math.min(10,deps.maxMessages),maxMessages:100,allowSync:true});
 const events=deps.messageId?0:await (deps.events??applyReceivedEvents)(deps.maxMessages);
 const materialized=deps.messageId?0:await materializeDueMessages(deps.now(),deps.maxMessages,deps.workspaceId);
 let dispatched=0;
 for(let i=0;i<deps.maxMessages;i++){
  const lease=await claimDispatch(deps.now(),deps.workspaceId?{workspaceId:deps.workspaceId,...(deps.messageId?{messageId:deps.messageId}:{})}:undefined);if(!lease)break;
  await (deps.dispatch??(lease=>dispatchOne(lease,{now:deps.now})))(lease);dispatched++;
 }
 return {events,materialized,dispatched};
}
