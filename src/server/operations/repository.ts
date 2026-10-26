import 'server-only';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import type {OperationEventsPage} from '../../domain/operation-events.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
const schema=z.strictObject({cursor:z.string().min(1).max(512).optional(),limit:z.number().int().min(1).max(100).optional()});
const cursorSchema=z.strictObject({workspaceId:z.string().min(1).max(120),sequence:z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(s=>BigInt(s)<=9223372036854775807n)});
const encode=(workspaceId:string,sequence:string)=>Buffer.from(JSON.stringify({workspaceId,sequence})).toString('base64url');
export async function readOperationEvents(p:Principal,input:{cursor?:string;limit?:number}):Promise<OperationEventsPage>{
 const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError(422,'Consulta de eventos inválida.');
 const {cursor,limit=50}=parsed.data;let after='0';
 if(cursor){try{if(!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();const decoded=cursorSchema.parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')));if(decoded.workspaceId!==p.workspaceId)throw Error();after=decoded.sequence;}catch{throw new AppError(422,'Cursor de eventos inválido para este workspace.');}}
 return withWorkspaceTransaction(p,async c=>{
  const head=(await c.query('SELECT sequence FROM app.operation_head WHERE workspace_id=$1',[p.workspaceId])).rows[0]?.sequence??'0';
  if(BigInt(after)>BigInt(head))throw new AppError(422,'Cursor de eventos à frente do histórico.');
  const rows=(await c.query('SELECT sequence,kind,entity_id,state,revision,recorded_at FROM app.operation_event WHERE workspace_id=$1 AND sequence>$2::bigint AND sequence<=$3::bigint ORDER BY sequence LIMIT $4',[p.workspaceId,after,head,limit+1])).rows;
  const hasMore=rows.length>limit,items=rows.slice(0,limit).map(r=>({sequence:r.sequence,kind:r.kind,entityId:r.entity_id,state:r.state,revision:r.revision,recordedAt:r.recorded_at.toISOString()}));
  return {items,hasMore,nextCursor:encode(p.workspaceId,items.at(-1)?.sequence??after)};
 });
}
