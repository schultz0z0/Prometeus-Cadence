import 'server-only';
import pg from 'pg';
import {decryptCredential} from './crypto.ts';
import type {IngressContext} from './ingress-contracts.ts';
let pool:pg.Pool|undefined;
export function ingressPool(){
 const url=process.env.INGRESS_DATABASE_URL;if(!url||new URL(url).username!=='cadence_ingress')throw Error('Ingress database role required.');
 if(!pool){pool=new pg.Pool({connectionString:url,max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,options:'-c search_path=app,public -c statement_timeout=15000'});pool.on('error',()=>{});}return pool;
}
export async function lookupIngress(publicId:string):Promise<IngressContext|null>{
 const row=(await ingressPool().query('SELECT app.lookup_channel_ingress($1) AS context',[publicId])).rows[0]?.context;if(!row)return null;
 const credentialVersions=row.envelopes.map((v:any)=>({revision:Number(v.revision),identifiers:v.identifiers,externalAccountId:v.externalAccountId,credentials:decryptCredential(v.envelope,{workspaceId:row.workspaceId,connectionId:row.id,provider:row.provider,revision:Number(v.revision)})}));
 delete row.envelopes;return {...row,revision:Number(row.revision),credentialVersions};
}
export async function markChallenge(id:string,revision:number){await ingressPool().query('SELECT app.mark_channel_challenge($1,$2)',[id,revision]);}
export async function closeIngressPool(){if(pool){await pool.end();pool=undefined;}}
