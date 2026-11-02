import {z} from 'zod';
export type AssistantCommand={kind:'create-cadence'|'create-audience-automation'|'qualify-list'|'draft-reply';payload:Record<string,unknown>};
export type AssistantCitation={kind:'help'|'fact';id:string};
export interface AssistantMessage{id:string;requestId:string;proposal?:AssistantProposal|null;role:'user'|'assistant';text:string;citations:AssistantCitation[];fallback:boolean;createdAt:string}
export interface AssistantReply{threadId:string;message:AssistantMessage;question:AssistantMessage;remaining:number}
export interface AssistantFacts{leads:number;lists:number;emailReady:boolean;whatsappReady:boolean;cadencesActive:number;cadencesTotal:number;billing:string}
export interface TodayItem{id:string;title:string;text:string;action:string;href:string;question:string}
export interface AssistantView{threadId:string|null;messages:AssistantMessage[];today:TodayItem[];aiAvailable:boolean;remaining:number}
export interface SearchHit{kind:'lead'|'list'|'cadence';id:string;label:string;detail:string;href:string}
export interface SearchPage{items:SearchHit[];nextCursor:string|null}

// Confirmation in the chat is consent, never authority: the permission must already belong to the user.
export function assistantActionAllowed(input:{requested:string;allowed:string[];confirmed:boolean}){
 return input.confirmed&&input.requested.length>0&&input.allowed.includes(input.requested);
}
export const assistantInputSchema=z.strictObject({
 threadId:z.uuid().optional(),
 text:z.string().trim().min(1).max(2000),
 contextRoute:z.string().max(200).regex(/^\/[A-Za-z0-9/_\-[\]]*$/),
 requestId:z.uuid(),
});
const nullable=(n:number)=>z.string().max(n).nullable();
const flatProposal=z.strictObject({kind:z.string().max(60),description:nullable(1000),channel:nullable(20),listId:nullable(200),objective:nullable(100),channels:z.array(z.string().max(20)).max(2).nullable(),tone:nullable(100),conversationId:nullable(200),text:nullable(4000)});
const outputSchema=z.strictObject({text:z.string().trim().min(1).max(4000),citations:z.array(z.strictObject({kind:z.string().max(20),id:z.string().max(100)})).max(10),proposal:z.unknown().optional()});
const str={type:['string','null']};
// Strict structured output allows no free-form objects, so the proposal is flat with nullable fields.
export const assistantOutputJsonSchema={type:'object',additionalProperties:false,required:['text','citations','proposal'],properties:{text:{type:'string'},citations:{type:'array',items:{type:'object',additionalProperties:false,required:['kind','id'],properties:{kind:{type:'string',enum:['help','fact']},id:{type:'string'}}}},
 proposal:{type:['object','null'],additionalProperties:false,required:['kind','description','channel','listId','objective','channels','tone','conversationId','text'],properties:{kind:{type:'string',enum:['create-audience-automation','create-cadence','qualify-list','draft-reply']},description:str,channel:str,listId:str,objective:str,channels:{type:['array','null'],items:{type:'string',enum:['EMAIL','WHATSAPP']}},tone:str,conversationId:str,text:str}}}};
// Citations outside the supplied sources are dropped: the model cannot point at data it was not given.
export function parseAssistantOutput(raw:unknown,sources:AssistantCitation[]|{kind:string;id:string}[]){
 const v=outputSchema.parse(raw),flat=flatProposal.safeParse(v.proposal??null),proposal=flat.success?flat.data:null,{kind,...fields}=proposal??{kind:''};
 // An invalid proposal is dropped on its own; the answer text still stands.
 return{text:v.text,citations:v.citations.filter(c=>sources.some(s=>s.kind===c.kind&&s.id===c.id)) as AssistantCitation[],
  proposal:proposal?{kind,payload:Object.fromEntries(Object.entries(fields).filter(([,x])=>x!==null))}:null};
}
export function todayItems(f:AssistantFacts):TodayItem[]{
 if(!f.emailReady&&!f.whatsappReady)return[{id:'channel',title:'Falta conectar um canal',href:'/settings/email',action:'Conectar um canal',question:'Como conecto um canal de envio?',
  text:`Sua conta ainda não tem um canal pronto para enviar. Enquanto isso, nenhuma mensagem sai${f.leads?`, mesmo com ${f.leads} leads na base`:''}. Conectar a caixa de e-mail leva poucos minutos e libera as cadências.`}];
 if(!f.leads)return[{id:'list',title:'Monte sua primeira lista',href:'/leads/generator',action:'Encontrar empresas',question:'Como encontro meus primeiros leads?',
  text:'O canal está pronto, mas ainda não há leads na base. Use o Gerador ou importe uma planilha para começar.'}];
 if(!f.cadencesActive)return[{id:'cadence-off',title:'Nenhuma cadência ligada',href:'/cadences',action:'Ver cadências',question:'Por que minha cadência não saiu hoje?',
  text:`Você tem canal pronto e ${f.leads} leads, mas nenhuma cadência está ligada. Revise uma cadência e ative para as mensagens saírem.`}];
 return[];
}
const ref=z.string().min(1).max(200);
// Closed allowlist: each command maps to an existing reviewed service; nothing here activates, publishes or sends.
export const commandSchemas={
 'create-audience-automation':z.strictObject({description:z.string().trim().min(3).max(1000),channel:z.enum(['email','whatsapp','both'])}),
 'create-cadence':z.strictObject({listId:ref,objective:z.string().trim().min(1).max(100),channels:z.array(z.enum(['EMAIL','WHATSAPP'])).min(1).max(2).refine(v=>new Set(v).size===v.length),tone:z.string().trim().min(1).max(100)}),
 'qualify-list':z.strictObject({listId:ref}),
 'draft-reply':z.strictObject({conversationId:ref,text:z.string().trim().min(1).max(4000)}),
} as const;
export type CommandKind=keyof typeof commandSchemas;
export const commandPermission:Record<CommandKind,'data.write'|'messages.reply'>={'create-audience-automation':'data.write','create-cadence':'data.write','qualify-list':'data.write','draft-reply':'messages.reply'};
export const commandLabels:Record<CommandKind,string>={'create-audience-automation':'Montar público e automações pausadas','create-cadence':'Gerar opções de cadência','qualify-list':'Qualificar uma lista','draft-reply':'Rascunho de resposta'};
export interface AssistantProposal{id:string;kind:CommandKind;payload:Record<string,unknown>;summary:string;state:'proposed'|'confirmed'|'cancelled';expiresAt:string;entityId:string|null;href:string|null}
// References must belong to the catalog shown to the model, which itself came from this workspace under RLS.
export function parseProposal(raw:unknown,catalog:{lists:string[];conversations:string[]}):AssistantCommand|null{
 if(!raw||typeof raw!=='object')return null;const v=raw as {kind?:unknown;payload?:unknown};
 if(typeof v.kind!=='string'||!Object.hasOwn(commandSchemas,v.kind))return null;
 const kind=v.kind as CommandKind,parsed=commandSchemas[kind].safeParse(v.payload);if(!parsed.success)return null;
 const p=parsed.data as Record<string,unknown>;
 if('listId' in p&&!catalog.lists.includes(p.listId as string))return null;
 if('conversationId' in p&&!catalog.conversations.includes(p.conversationId as string))return null;
 return{kind,payload:p};
}
