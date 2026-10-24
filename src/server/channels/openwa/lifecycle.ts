import 'server-only';
import {randomBytes} from 'node:crypto';import {z} from 'zod';
import type {Principal} from '../../../domain/workspace.ts';import type {OpenwaCommand,OpenwaQrView} from '../../../domain/openwa.ts';
import {withWorkspaceTransaction} from '../../db/transaction.ts';import {AppError} from '../../errors.ts';import {lockWorkspace} from '../../prospecting/ingestion.ts';
import {requireChannelAdmin,connectionRow,commandHash,priorCommand,completeCommand,readCredentialInTransaction} from '../repository.ts';
import {encryptCredential} from '../crypto.ts';import {createOpenwaRecord,readOpenwaRecord,openwaRow,openwaView} from './repository.ts';
import {createOpenwaClient,OpenwaClientError} from './client.ts';import {openwaGatewayConfig} from './provisioning.ts';
export {runOpenwaMaintenanceTick} from './provisioning.ts';
export const requestOpenwaConnection=createOpenwaRecord;
export const readOpenwaConnection=readOpenwaRecord;
const commandSchema=z.strictObject({requestId:z.uuid(),expectedRevision:z.number().int().min(1)});
export async function readOpenwaQr(p:Principal,id:string,revision:number):Promise<OpenwaQrView>{
 const scope=()=>withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);const row=await connectionRow(c,id),q=await openwaRow(c,id);
  if(row.provider!=='openwa'||Number(row.revision)!==revision||q.desired_state!=='connected')throw new AppError(409,'A conexão mudou. Abra o pareamento novamente.','OPENWA_CHANGED');
  const available=q.phase==='qr_ready'&&q.webhook_registered&&q.remote_session_id&&q.api_key_id;
  const secrets=available?(await readCredentialInTransaction(c,id)).credentials:null;
  return {phase:q.phase,available,sessionId:q.remote_session_id,apiKey:secrets?.apiKey};
 });
 const before=await scope();let qrCode:string|null=null;
 if(before.available){
  try{const gateway=openwaGatewayConfig();qrCode=(await createOpenwaClient({origin:gateway.origin,apiKey:before.apiKey!}).readQr(before.sessionId)).qrCode;}
  catch(error){if(!(error instanceof OpenwaClientError&&[400,404,409].includes(error.status)))throw new AppError(503,'QR indisponível. Confira o estado da conexão.','OPENWA_QR_UNAVAILABLE');}
 }
 const after=await scope();if(after.phase!=='qr_ready'||!after.available)qrCode=null;
 return {connectionId:id,revision,qrCode,phase:after.phase,refreshAfterMs:3000};
}
async function requestState(p:Principal,id:string,input:OpenwaCommand,desired:'connected'|'disconnected'){
 const parsed=commandSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Comando de conexão inválido.');const body=parsed.data;
 return withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'openwa.'+desired,id,input:body}),old=await priorCommand<Awaited<ReturnType<typeof openwaView>>>(c,p,body.requestId,hash);if(old)return old;
  const conn=await connectionRow(c,id,true),q=await openwaRow(c,id,true);
  if(conn.provider!=='openwa'||Number(conn.revision)!==body.expectedRevision)throw new AppError(409,'A conexão mudou. Revise novamente.');
  if(desired==='connected'&&q.desired_state==='disconnected'&&q.stage!=='idle')throw new AppError(409,'Aguarde a desconexão remota antes de parear novamente.','OPENWA_DISCONNECT_PENDING');
  const secrets=(await readCredentialInTransaction(c,id)).credentials,revision=body.expectedRevision+1;
  const next=desired==='connected'?{webhookSecret:randomBytes(32).toString('hex')}:secrets;
  await c.query("UPDATE app.channel_connection SET revision=$2,state=$3,credentials_verified=false,updated_at=clock_timestamp() WHERE id=$1",[id,revision,desired==='connected'?'pending':'disconnected']);
  await c.query('SELECT app.write_channel_credential($1,$2,$3)',[id,revision,encryptCredential(next,{workspaceId:p.workspaceId,connectionId:id,provider:'openwa',revision})]);
  await c.query('UPDATE app.channel_sender SET ready=false,revision=revision+1 WHERE connection_id=$1',[id]);
  await c.query("UPDATE app.openwa_connection SET revision=$2,desired_state=$3,phase='provisioning',stage=CASE WHEN $3='disconnected' THEN 'logout' WHEN remote_session_id IS NULL THEN 'session' ELSE 'key' END,requested_by=$4,restart_requested=($3='connected'),webhook_registered=false,automation_paused=false,attempts=0,error_code=NULL,lease_token=NULL,lease_until=NULL,lease_revision=NULL,fence=fence+1,next_at=clock_timestamp(),updated_at=clock_timestamp() WHERE connection_id=$1",[id,revision,desired,p.userId]);
  const result=await openwaView(c,id);await completeCommand(c,p,body.requestId,hash,result,'openwa.'+desired);return result;
 });
}
export const requestOpenwaReconnect=(p:Principal,id:string,command:OpenwaCommand)=>requestState(p,id,command,'connected');
export const requestOpenwaDisconnect=(p:Principal,id:string,command:OpenwaCommand)=>requestState(p,id,command,'disconnected');
