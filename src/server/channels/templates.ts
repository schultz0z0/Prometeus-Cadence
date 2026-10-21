import 'server-only';
import {randomUUID} from 'node:crypto';
import type {Principal} from '../../domain/workspace.ts';
import type {TemplateView} from '../../domain/whatsapp.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {AppError} from '../errors.ts';
import {requireChannelAdmin,connectionRow} from './repository.ts';
import {configInTransaction,providerAdapter} from './connections.ts';
import type {ProviderAdapter} from './providers/contracts.ts';
export async function syncTemplates(p:Principal,id:string,expectedRevision:number,deps:{adapter?:ProviderAdapter}={}):Promise<TemplateView[]>{
 const config=await withWorkspaceTransaction(p,c=>configInTransaction(c,id,expectedRevision));
 const catalog=await (deps.adapter??providerAdapter(config.provider)).listTemplates(config);
 return withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const row=await connectionRow(c,id,true);if(Number(row.revision)!==expectedRevision||row.state==='disconnected')throw new AppError(409,'A conexão mudou durante a sincronização.');
  const old=(await c.query('SELECT * FROM app.channel_remote_template WHERE connection_id=$1',[id])).rows,map=new Map(old.map(r=>[r.remote_id,r]));const result:TemplateView[]=[];
  for(const incoming of catalog){
   const prior=map.get(incoming.remoteId);const template={...incoming,id:prior?.id??randomUUID(),revision:prior?Number(prior.revision)+(prior.payload.hash===incoming.hash?0:1):1};
   await c.query('INSERT INTO app.channel_remote_template(workspace_id,id,connection_id,remote_id,revision,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,synced_at=clock_timestamp()',[p.workspaceId,template.id,id,template.remoteId,template.revision,template]);result.push(template);map.delete(incoming.remoteId);
  }
  for(const missing of map.values()){
   const next={...missing.payload,status:'unknown',revision:Number(missing.revision)+1,hash:'missing:'+missing.payload.hash};
   if(missing.payload.status!=='unknown')await c.query('UPDATE app.channel_remote_template SET payload=$2,revision=$3,synced_at=clock_timestamp() WHERE id=$1',[missing.id,next,next.revision]);
  }
  return result;
 });
}
