import 'server-only';
import {z} from 'zod';
import {commandSchemas,type CommandKind} from '../../domain/assistant-actions.ts';
import {mcpConfirmRequestId} from '../../domain/mcp-authorization.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {cancelAssistantAction,confirmAssistantAction,prepareAssistantAction,proposalError} from '../assistant/commands.ts';
import {proposalSummary} from '../assistant/service.ts';
import {mcpBase} from './authorization.ts';
import type {McpContext} from './service.ts';
// 07C.3b: MCP writes are the assistant's reviewed proposals, owned by the connection that prepared them.
const reviewUrl=(id:string)=>mcpBase()+'/mcp/review/'+encodeURIComponent(id);
export async function prepareFromMcp(ctx:McpContext,kind:CommandKind,raw:unknown){
 const p=ctx.principal,v=commandSchemas[kind].parse(raw) as Record<string,any>;
 const id=await withWorkspaceTransaction(p,async c=>{
  // The reference must exist in this workspace under RLS; the summary is written here, never by the client.
  const lists=v.listId?(await c.query('SELECT l.id,l.name,(SELECT count(*)::int FROM app.lead WHERE list_id=l.id) leads FROM app.list l WHERE l.id=$1',[v.listId])).rows:[];
  if(v.listId&&!lists.length)throw new AppError(404,'A lista não existe neste workspace. Use lists_list para ver as listas.');
  const conversations=v.conversationId?(await c.query(`SELECT cc.id,cc.channel,coalesce(nullif(ld.payload->>'name',''),'Contato') contact,'' "lastInbound" FROM app.channel_conversation cc
   LEFT JOIN app.lead ld ON ld.workspace_id=cc.workspace_id AND ld.id=cc.lead_id WHERE cc.id=$1`,[v.conversationId])).rows:[];
  if(v.conversationId&&!conversations.length)throw new AppError(404,'A conversa não existe neste workspace. Use conversations_list para ver as conversas.');
  return (await c.query('SELECT app.mcp_propose($1,$2,$3,$4) id',[ctx.grantId,kind,v,proposalSummary({kind,payload:v},{lists,conversations})])).rows[0].id as string;
 }).catch(e=>{throw proposalError(e);});
 // A prepare that fails or is blocked leaves nothing open: the client would not see it, and it would count toward the cap.
 const drop=()=>cancelAssistantAction(p,id).catch(()=>{});
 let prepared;try{prepared=await prepareAssistantAction(p,id);}catch(e){await drop();throw e;}
 const {proposal,review}=prepared;
 if(review.blockers.length){await drop();return {summary:proposal.summary,blockers:review.blockers,warnings:review.warnings,next:'Há bloqueios: explique-os à pessoa; nada foi criado.'};}
 const confirm=ctx.scopes.includes('actions.confirm');
 return {proposalId:id,summary:proposal.summary,expiresAt:review.expiresAt,warnings:review.warnings,blockers:review.blockers,estimatedUsage:review.usage??[],reviewUrl:reviewUrl(id),
  ...(confirm?{confirmation:review.token}:{}),
  next:confirm?'Mostre o resumo, os avisos e o uso estimado à pessoa e só chame action_confirm com proposalId e confirmation depois que ela concordar.'
   :'Peça para a pessoa abrir reviewUrl, revisar e confirmar no Prometeus Cadence. Esta conexão não confirma ações.'};
}
const idSchema=z.string().min(1).max(200);
async function own(ctx:McpContext,id:string){
 const found=idSchema.safeParse(id).success&&(await withWorkspaceTransaction(ctx.principal,c=>c.query('SELECT 1 FROM app.assistant_proposal WHERE id=$1 AND grant_id=$2',[id,ctx.grantId]))).rowCount;
 if(!found)throw new AppError(404,'Ação não encontrada nesta conexão. Prepare de novo.');
}
export async function confirmFromMcp(ctx:McpContext,a:{proposalId:string;confirmation:string}){
 await own(ctx,a.proposalId);
 const r=await confirmAssistantAction(ctx.principal,a.proposalId,{token:a.confirmation,requestId:mcpConfirmRequestId(a.proposalId,a.confirmation)});
 return {state:r.proposal.state,summary:r.proposal.summary,entityId:r.entityId,url:mcpBase()+r.href};
}
export async function cancelFromMcp(ctx:McpContext,a:{proposalId:string}){
 await own(ctx,a.proposalId);
 const r=await cancelAssistantAction(ctx.principal,a.proposalId);
 return {state:r.state,summary:r.summary};
}
