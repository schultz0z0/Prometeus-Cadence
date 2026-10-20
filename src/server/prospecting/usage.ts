import type {PoolClient} from 'pg';
import type {Units,ProviderUsage} from '../../domain/prospecting.ts';
import {AppError} from '../errors.ts';
export async function reserveUsage(c:PoolClient,operation:{jobId:string;operationId:string;units:Units;caps:Units;globalCaps:Units}){
  try{await c.query('SELECT app.reserve_prospecting_usage($1,$2,$3,$4,$5)',[operation.jobId,operation.operationId,operation.units,operation.caps,operation.globalCaps]);}
  catch(e){if(e instanceof Error&&e.message==='USAGE_LIMIT')throw new AppError(429,'O orçamento de uso disponível não permite esta execução.','USAGE_LIMIT');throw e;}
}
export async function settleUsage(c:PoolClient,jobId:string,usage:ProviderUsage){
  // Converting a reservation into consumption preserves the total held+spent.
  const prior=(await c.query("SELECT units,metadata FROM app.usage_ledger WHERE operation_id=$1 AND event='consume'",[usage.operationId])).rows[0];
  if(prior){if(JSON.stringify(prior.units)!==JSON.stringify(usage.units))throw new AppError(409,'Uso já registrado com outro resultado.');return;}
  await c.query("INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units,cost_usd,cost_kind,provider,metadata) VALUES(current_setting('app.workspace_id'),$1,$2,'consume',$3,$4,$5,$6,$7)",[jobId,usage.operationId,usage.units,usage.costUsd,usage.costKind,usage.provider,{inputTokens:usage.inputTokens,outputTokens:usage.outputTokens}]);
  await c.query("INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units) VALUES(current_setting('app.workspace_id'),$1,$2,'release',$3)",[jobId,usage.operationId,usage.units]);
}
export async function releaseUnused(c:PoolClient,jobId:string){
  const rows=(await c.query("SELECT event,units FROM app.usage_ledger WHERE job_id=$1 AND event IN('reserve','release')",[jobId])).rows;
  const remaining:Record<string,number>={};
  for(const r of rows)for(const [key,value]of Object.entries(r.units as Units))remaining[key]=(remaining[key]??0)+(r.event==='reserve'?1:-1)*(value??0);
  for(const k of Object.keys(remaining))remaining[k]=Math.max(0,remaining[k]);
  await c.query("INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units) VALUES(current_setting('app.workspace_id'),$1,$2,'release',$3) ON CONFLICT DO NOTHING",[jobId,jobId+':close',remaining]);
}
