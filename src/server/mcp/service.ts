import 'server-only';
import type {Principal} from '../../domain/workspace.ts';
import {mcpScopeAllowed,negotiateMcpVersion,type McpRequest} from '../../domain/mcp-authorization.ts';
import {AppError} from '../errors.ts';
import {capabilities} from '../auth/permissions.ts';
import {MCP_TOOLS,mcpTool} from './tools.ts';
// 07C.3a: the JSON-RPC methods of the MCP endpoint. Tool failures are results (isError); protocol failures are errors.
export type McpContext={principal:Principal;scopes:string[];grantId:string};
export class McpScopeError extends Error{scope:string;constructor(scope:string){super('insufficient_scope');this.scope=scope;}}
type Reply={jsonrpc:'2.0';id:string|number|null;result?:unknown;error?:{code:number;message:string}};
const ok=(id:Reply['id'],result:unknown):Reply=>({jsonrpc:'2.0',id,result});
export const rpcError=(id:Reply['id'],code:number,message:string):Reply=>({jsonrpc:'2.0',id,error:{code,message}});
const allowed=(ctx:McpContext,scope:string)=>mcpScopeAllowed({required:scope,granted:ctx.scopes,membershipActive:true});
// A tool whose permission the role lacks is not offered at all.
const roleAllows=(ctx:McpContext,t:{permission?:string})=>!t.permission||(capabilities(ctx.principal.role) as string[]).includes(t.permission);
/** Returns null for a notification (answered with 202). */
export async function handleMcp(ctx:McpContext,m:McpRequest):Promise<Reply|null>{
 const id=m.id??null;
 if(m.id===undefined)return null;
 switch(m.method){
  case 'initialize':return ok(id,{protocolVersion:negotiateMcpVersion(m.params?.protocolVersion),capabilities:{tools:{listChanged:false}},
   serverInfo:{name:'prometeus-cadence',title:'Prometeus Cadence',version:'1.0.0'},
   instructions:'Opera o workspace do Prometeus Cadence com as permissões que o usuário autorizou. Consulta contatos, listas, execuções e métricas. As ferramentas *_prepare só preparam uma ação para revisão: nada é criado, enviado ou ativado antes da confirmação. Mostre o resumo, os avisos e o uso estimado à pessoa; confirme com action_confirm só depois que ela concordar, ou peça para ela confirmar no link de revisão.'});
  case 'ping':return ok(id,{});
  case 'tools/list':return ok(id,{tools:MCP_TOOLS.filter(t=>allowed(ctx,t.scope)&&roleAllows(ctx,t)).map(t=>({name:t.name,title:t.title,description:t.description,inputSchema:t.inputSchema,annotations:t.annotations}))});
  case 'tools/call':{
   const tool=mcpTool(m.params?.name);if(!tool)return rpcError(id,-32602,'Ferramenta desconhecida.');
   if(!allowed(ctx,tool.scope))throw new McpScopeError(tool.scope);
   if(!roleAllows(ctx,tool))return ok(id,{isError:true,content:[{type:'text',text:'Seu papel neste workspace não permite esta ação.'}]});
   const args=tool.args.safeParse(m.params?.arguments??{});
   if(!args.success)return ok(id,{isError:true,content:[{type:'text',text:'Argumentos inválidos: '+(args.error.issues[0]?.message??'confira o formato.')}]});
   try{return ok(id,{content:[{type:'text',text:JSON.stringify(await tool.run(ctx,args.data))}]});}
   catch(e){
    // Lost access is a protocol-level refusal; any other failure is reported to the model without internals.
    if(e instanceof AppError&&(e.status===401||e.status===403))throw e;
    return ok(id,{isError:true,content:[{type:'text',text:e instanceof AppError&&e.status<500?e.message:'Não foi possível concluir agora. Tente de novo.'}]});}
  }
  default:return rpcError(id,-32601,'Método não suportado.');
 }
}
