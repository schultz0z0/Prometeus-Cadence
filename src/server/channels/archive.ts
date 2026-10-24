import 'server-only';
import {z} from 'zod';import type {Principal} from '../../domain/workspace.ts';import {AppError} from '../errors.ts';import {withWorkspaceTransaction} from '../db/transaction.ts';import {lockWorkspace} from '../prospecting/ingestion.ts';import {commandHash,priorCommand,completeCommand,requireChannelAdmin,connectionRow} from './repository.ts';
const schema=z.strictObject({requestId:z.uuid(),expectedRevision:z.number().int().positive()});
export async function archiveConnection(p:Principal,id:string,input:unknown){
 const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError(422,'Comando de remoção inválido.');const body=parsed.data;
 return withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'channel.archive',id,input:body}),prior=await priorCommand<{archived:true}>(c,p,body.requestId,hash);if(prior)return prior;
  const row=await connectionRow(c,id,true);if(row.channel!=='WHATSAPP'||row.state!=='disconnected'||Number(row.revision)!==body.expectedRevision)throw new AppError(409,'Desconecte a conta antes de removê-la da lista.');
  try{await c.query('SELECT app.archive_channel_connection($1,$2)',[id,body.expectedRevision]);}catch(error){if(error instanceof Error&&/^ARCHIVE_/.test(error.message))throw new AppError(409,'Aguarde a desconexão terminar e resolva os envios pendentes antes de remover.');throw error;}
  const result={archived:true as const};await completeCommand(c,p,body.requestId,hash,result,'channel.archive');return result;
 });
}
