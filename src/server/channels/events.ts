import 'server-only';
import type {AuthenticatedBatch} from '../../domain/whatsapp.ts';
import {ingressPool} from './ingress-db.ts';
export async function ingestAuthenticatedBatch(batch:AuthenticatedBatch):Promise<{stored:number;duplicates:number}>{
 return (await ingressPool().query('SELECT app.ingest_channel_batch($1) AS result',[batch])).rows[0].result;
}
export async function applyReceivedEvents(limit:number):Promise<number>{
 if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid event batch limit');
 // Legacy timestamp REST lookups are retired; Meta and OpenWA carry authenticated event times.
 return 0;
}

export async function pruneIngestMetadata(now:string):Promise<number>{
 if(!Number.isFinite(Date.parse(now)))throw Error('Invalid retention clock');
 return Number((await ingressPool().query('SELECT app.prune_channel_ingest_metadata($1) AS count',[now])).rows[0].count);
}
