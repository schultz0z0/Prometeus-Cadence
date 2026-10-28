import 'server-only';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import type {DeliveryEvidence} from '../../domain/channel-evidence.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
const iso=(value:Date|string|null|undefined)=>value?new Date(value).toISOString():null;
// Connection health and local read markers never count as provider receipts.
export function messageDeliveryEvidence(row:Record<string,any>):DeliveryEvidence|null{
 if(row.direction!=='outbound')return null;
 const mail=row.channel==='EMAIL';
 return {messageId:row.id,state:row.state,acceptedAt:iso(row.accepted_at),deliveredAt:mail?null:iso(row.delivered_at),readAt:mail?null:iso(row.read_at),supported:mail?['accepted']:['accepted','delivered','read']};
}
export async function readDeliveryEvidence(p:Principal,messageId:string):Promise<DeliveryEvidence>{
 if(!z.uuid().safeParse(messageId).success)throw new AppError(422,'Mensagem inválida.');
 return withWorkspaceTransaction(p,async c=>{
  const row=(await c.query("SELECT * FROM app.channel_message WHERE id=$1 AND direction='outbound'",[messageId])).rows[0];
  if(!row)throw new AppError(404,'Mensagem enviada não encontrada.');return messageDeliveryEvidence(row)!;
 });
}
