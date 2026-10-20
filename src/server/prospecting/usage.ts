import type {PoolClient} from 'pg';
import type {Units,ProviderUsage} from '../../domain/prospecting.ts';
import {AppError} from '../errors.ts';
import {hashValue} from './review.ts';
export async function reserveUsage(c:PoolClient,operation:{jobId:string;operationId:string;units:Units;caps:Units;globalCaps:Units}){
  try{await c.query('SELECT app.reserve_prospecting_usage($1,$2,$3,$4,$5)',[operation.jobId,operation.operationId,operation.units,operation.caps,operation.globalCaps]);}
  catch(e){if(e instanceof Error&&e.message==='USAGE_LIMIT')throw new AppError(429,'O orçamento de uso disponível não permite esta execução.','USAGE_LIMIT');throw e;}
}
export async function settleUsage(c:PoolClient,jobId:string,usage:ProviderUsage){
  await c.query('SELECT 1 FROM app.prospecting_job WHERE id=$1 FOR UPDATE',[jobId]);
  // Converting a reservation into consumption preserves the total held+spent.
  const prior=(await c.query("SELECT units,metadata FROM app.usage_ledger WHERE operation_id=$1 AND event='consume'",[usage.operationId])).rows[0];
  if(prior){if(hashValue(prior.units)!==hashValue(usage.units))throw new AppError(409,'Uso já registrado com outro resultado.');return;}
  await assertReserved(c,jobId,usage.units);
  await c.query("INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units,cost_usd,cost_kind,provider,metadata) VALUES(current_setting('app.workspace_id'),$1,$2,'consume',$3,$4,$5,$6,$7)",[jobId,usage.operationId,usage.units,usage.costUsd,usage.costKind,usage.provider,{inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,fetchedCount:usage.fetchedCount,acceptedCount:usage.acceptedCount}]);
  await c.query("INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units) VALUES(current_setting('app.workspace_id'),$1,$2,'release',$3)",[jobId,usage.operationId,usage.units]);
}
export async function assertReserved(c:PoolClient,jobId:string,units:Units){
  const rows=(await c.query("SELECT event,units FROM app.usage_ledger WHERE job_id=$1 AND event IN('reserve','release')",[jobId])).rows;
  for(const [unit,count]of Object.entries(units)){
    if(!['candidates','apifyRuns','apolloPages','jevCalls','codexCalls'].includes(unit)||!Number.isSafeInteger(count)||count<0)throw new AppError(422,'Unidade de uso inválida.');
    const remaining=rows.reduce((n,r)=>n+(r.event==='reserve'?1:-1)*Number(r.units[unit]??0),0);
    if(count>remaining)throw new AppError(429,'A execução atingiu a reserva confirmada.','USAGE_LIMIT');
  }
}
export async function releaseUnused(c:PoolClient,jobId:string){
  const rows=(await c.query("SELECT event,units FROM app.usage_ledger WHERE job_id=$1 AND event IN('reserve','release')",[jobId])).rows;
  const remaining:Record<string,number>={};
  for(const r of rows)for(const [key,value]of Object.entries(r.units as Units))remaining[key]=(remaining[key]??0)+(r.event==='reserve'?1:-1)*(value??0);
  for(const k of Object.keys(remaining))remaining[k]=Math.max(0,remaining[k]);
  await c.query("INSERT INTO app.usage_ledger(workspace_id,job_id,operation_id,event,units) VALUES(current_setting('app.workspace_id'),$1,$2,'release',$3) ON CONFLICT DO NOTHING",[jobId,jobId+':close',remaining]);
}
