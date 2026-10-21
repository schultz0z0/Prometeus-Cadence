import 'server-only';
import type {AuthenticatedBatch} from '../../domain/whatsapp.ts';
import {ingressPool,lookupIngress} from './ingress-db.ts';
import {providerAdapter} from './connections.ts';
export async function ingestAuthenticatedBatch(batch:AuthenticatedBatch):Promise<{stored:number;duplicates:number}>{
 return (await ingressPool().query('SELECT app.ingest_channel_batch($1) AS result',[batch])).rows[0].result;
}
export async function applyReceivedEvents(limit:number):Promise<number>{
 if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid event batch limit');let processed=0;
 for(let i=0;i<limit;i++){
  const job=(await ingressPool().query('SELECT app.claim_channel_time_lookup() AS job')).rows[0]?.job;if(!job)break;
  let at:string|null=null;
  try{
   const ctx=await lookupIngress(job.publicId),version=ctx?.credentialVersions.find(v=>v.revision===ctx.revision);
   if(ctx&&version&&ctx.provider==='twilio'&&ctx.state!=='disconnected'){
    const outcome=await providerAdapter(ctx.provider).lookupMessage({provider:ctx.provider,connectionId:ctx.id,revision:ctx.revision,identifiers:ctx.identifiers,credentials:version.credentials,sender:null,templates:[]},job.remoteId);
    if(outcome?.kind==='accepted')at=outcome.acceptedAt;
   }
  }catch{ /* Preserve the pending evidence for a bounded later lookup. */ }
  await ingressPool().query('SELECT app.finish_channel_time_lookup($1,$2,$3)',[job.eventId,job.token,at]);processed++;
 }
 return processed;
}
export async function pruneIngestMetadata(now:string):Promise<number>{
 if(!Number.isFinite(Date.parse(now)))throw Error('Invalid retention clock');
 return Number((await ingressPool().query('SELECT app.prune_channel_ingest_metadata($1) AS count',[now])).rows[0].count);
}
