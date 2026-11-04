import 'server-only';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import type {McpScope} from '../../domain/mcp-authorization.ts';
import {readContacts} from '../contacts/repository.ts';
import {listJobs} from '../prospecting/service.ts';
import {readMessageMetrics} from '../messaging/metrics.ts';
// 07C.3a: read-only tools. Each one reuses the service the app itself calls, under the same Principal and RLS.
type Tool={name:string;title:string;description:string;scope:McpScope;inputSchema:Record<string,unknown>;args:z.ZodType;run:(p:Principal,a:any)=>Promise<unknown>};
const contactsArgs=z.strictObject({query:z.string().trim().max(100).optional(),listId:z.string().trim().max(120).optional(),
 qualification:z.enum(['qualified','pending','warning','disqualified']).optional(),replied:z.boolean().optional(),limit:z.number().int().min(1).max(25).default(10)});
export const MCP_TOOLS:Tool[]=[
 {name:'contacts_search',title:'Buscar contatos',scope:'contacts.read',description:'Busca contatos do workspace por nome, empresa, e-mail, telefone ou cidade, com filtros de lista, qualificação e resposta. Até 25 por chamada.',
  inputSchema:{type:'object',additionalProperties:false,properties:{query:{type:'string',maxLength:100},listId:{type:'string'},qualification:{type:'string',enum:['qualified','pending','warning','disqualified']},replied:{type:'boolean'},limit:{type:'integer',minimum:1,maximum:25}}},
  args:contactsArgs,run:async(p,a:z.infer<typeof contactsArgs>)=>{
   const page=await readContacts(p,{search:a.query,listId:a.listId,qualification:a.qualification,reply:a.replied===undefined?undefined:a.replied?'yes':'no',page:1,pageSize:a.limit} as never);
   return {total:page.total,contacts:page.items.map(l=>({id:l.id,name:l.name,company:l.companyName??null,email:l.email??null,phone:l.phone??null,city:l.city??null,state:l.state??null,qualification:l.qualification??null,listId:l.listId??null}))};}},
 {name:'jobs_list',title:'Ver execuções',scope:'jobs.read',description:'Lista as execuções recentes (geração, qualificação, enriquecimento) com o estado de cada uma.',
  inputSchema:{type:'object',additionalProperties:false,properties:{limit:{type:'integer',minimum:1,maximum:25}}},
  args:z.strictObject({limit:z.number().int().min(1).max(25).default(10)}),run:async(p,a:{limit:number})=>{const r=await listJobs(p,{limit:a.limit});return {jobs:r.items};}},
 {name:'metrics_read',title:'Ler métricas',scope:'metrics.read',description:'Mensagens enviadas, respostas, falhas e descadastros por canal nos últimos N dias (1 a 90).',
  inputSchema:{type:'object',additionalProperties:false,properties:{days:{type:'integer',minimum:1,maximum:90}}},
  args:z.strictObject({days:z.number().int().min(1).max(90).default(7)}),run:(p,a:{days:number})=>readMessageMetrics(p,{days:a.days})},
];
export const mcpTool=(name:unknown)=>MCP_TOOLS.find(t=>t.name===name);
