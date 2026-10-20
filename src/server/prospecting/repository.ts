import type {PoolClient} from 'pg';
import type {JobLease,JobView,JobItemView} from '../../domain/prospecting.ts';
import {AppError} from '../errors.ts';
type Row=Record<string,any>;
export function jobView(r:Row):JobView{return{id:r.id,kind:r.kind,source:r.source,state:r.state,listId:r.list_id,createdBy:r.actor_id,createdAt:new Date(r.created_at).toISOString(),updatedAt:new Date(r.updated_at).toISOString(),revision:Number(r.revision),counts:r.counts,testFixture:r.checkpoint?.fixture===true,error:r.error_code?{code:r.error_code,message:r.error_message??'A execução precisa de atenção.'}:null};}
export function itemView(r:Row):JobItemView{return{id:r.id,leadId:r.lead_id,sourceRef:r.source_ref,name:r.name,status:r.status,results:r.payload?.results??[],applied:r.applied};}
export async function assertJobLease(c:PoolClient,lease:JobLease,control=false,finishing=false){
  const states=finishing?['running','waiting_provider','cancelling','cancelled','completed','partial','failed','needs_reconciliation']:control?['running','waiting_provider','cancelling']:['running','waiting_provider'];
  const r=(await c.query("SELECT 1 FROM app.prospecting_job WHERE workspace_id=$1 AND id=$2 AND actor_id=$3 AND lease_token=$4 AND fence=$5 AND lease_until>clock_timestamp() AND state=ANY($6::text[]) FOR UPDATE",[lease.workspaceId,lease.jobId,lease.actorId,lease.token,lease.fence,states])).rows[0];
  if(!r||!(await c.query('SELECT app.current_role() AS role')).rows[0]?.role)throw new AppError(409,'A execução perdeu a autorização ou a lease.','STALE_JOB');
}
export function encodeCursor(value:unknown){return Buffer.from(JSON.stringify(value)).toString('base64url');}
export function decodeCursor(cursor:string|undefined):{date?:string;id:string}|null{
  if(!cursor)return null;
  try{const v=JSON.parse(Buffer.from(cursor,'base64url').toString());if(typeof v.id!=='string'||v.id.length>120||(v.date!==undefined&&(typeof v.date!=='string'||Number.isNaN(Date.parse(v.date)))))throw Error();return v;}catch{throw new AppError(422,'Página inválida.');}
}
