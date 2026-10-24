import 'server-only';
import {randomBytes,randomUUID} from 'node:crypto';import type {PoolClient} from 'pg';import {z} from 'zod';
import type {Principal} from '../../../domain/workspace.ts';import type {OpenwaConnectionView,OpenwaPhase} from '../../../domain/openwa.ts';
import {withWorkspaceTransaction} from '../../db/transaction.ts';import {AppError} from '../../errors.ts';
import {lockWorkspace} from '../../prospecting/ingestion.ts';
import {commandHash,priorCommand,completeCommand,requireChannelAdmin,connectionRow,connectionView} from '../repository.ts';
import {encryptCredential} from '../crypto.ts';

const createSchema=z.strictObject({requestId:z.uuid(),name:z.string().trim().min(1).max(120)});
export function openwaPlatformCaps(){
 const cap=(name:string,fallback:number)=>{const value=process.env[name]??String(fallback);if(!/^[1-9]\d{0,5}$/.test(value)||Number(value)>100000)throw Error('Invalid OpenWA platform limit');return Number(value);};
 const daily=cap('OPENWA_PLATFORM_DAILY_CAP',20),newConversation=cap('OPENWA_PLATFORM_NEW_CONVERSATION_CAP',5);
 if(newConversation>daily)throw Error('Invalid OpenWA platform limit');return {daily,newConversation};
}
export async function openwaRow(c:PoolClient,id:string,lock=false){
 const row=(await c.query('SELECT * FROM app.openwa_connection WHERE connection_id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];
 if(!row)throw new AppError(404,'Conexão OpenWA não encontrada.');return row;
}
export async function openwaView(c:PoolClient,id:string):Promise<OpenwaConnectionView>{
 const row=await openwaRow(c,id),conn=await connectionRow(c,id),caps=openwaPlatformCaps();
 if(conn.provider!=='openwa')throw new AppError(404,'Conexão OpenWA não encontrada.');
 return {connection:await connectionView(c,conn),phase:row.phase as OpenwaPhase,phone:row.phone,lastCheckedAt:row.last_checked_at?.toISOString()??null,errorCode:row.error_code,platformDailyCap:caps.daily,platformNewConversationCap:caps.newConversation};
}
export async function createOpenwaRecord(p:Principal,input:{requestId:string;name:string}):Promise<OpenwaConnectionView>{
 const parsed=createSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Nome da conexão inválido.');const body=parsed.data;
 return withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await c.query('INSERT INTO app.workspace_meta(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[p.workspaceId]);await lockWorkspace(c);
  const hash=commandHash({action:'openwa.create',input:body}),old=await priorCommand<OpenwaConnectionView>(c,p,body.requestId,hash);if(old)return old;
  const id=randomUUID(),revision=1,publicId=randomBytes(32).toString('base64url');
  await c.query("INSERT INTO app.channel_connection(workspace_id,id,provider,name,revision,public_id,identifiers,created_by) VALUES($1,$2,'openwa',$3,$4,$5,'{}',$6)",[p.workspaceId,id,body.name,revision,publicId,p.userId]);
  await c.query('SELECT app.write_channel_credential($1,$2,$3)',[id,revision,encryptCredential({webhookSecret:randomBytes(32).toString('hex')},{workspaceId:p.workspaceId,connectionId:id,provider:'openwa',revision})]);
  await c.query('INSERT INTO app.openwa_connection(workspace_id,connection_id,revision,remote_name,requested_by) VALUES($1,$2,$3,$4,$5)',[p.workspaceId,id,revision,`pc-${id}`,p.userId]);
  const result=await openwaView(c,id);await completeCommand(c,p,body.requestId,hash,result,'openwa.create');return result;
 });
}
export async function readOpenwaRecord(p:Principal,id:string):Promise<OpenwaConnectionView>{
 if(!z.uuid().safeParse(id).success)throw new AppError(404,'Conexão OpenWA não encontrada.');
 return withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);return openwaView(c,id);});
}
