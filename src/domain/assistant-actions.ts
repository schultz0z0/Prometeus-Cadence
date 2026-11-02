import {z} from 'zod';
export type AssistantCommand={kind:'create-cadence'|'create-audience-automation'|'qualify-list'|'draft-reply';payload:Record<string,unknown>};
export type AssistantCitation={kind:'help'|'fact';id:string};
export interface AssistantMessage{id:string;requestId:string;role:'user'|'assistant';text:string;citations:AssistantCitation[];fallback:boolean;createdAt:string}
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
const outputSchema=z.strictObject({text:z.string().trim().min(1).max(4000),citations:z.array(z.strictObject({kind:z.string().max(20),id:z.string().max(100)})).max(10)});
export const assistantOutputJsonSchema={type:'object',additionalProperties:false,required:['text','citations'],properties:{text:{type:'string'},citations:{type:'array',items:{type:'object',additionalProperties:false,required:['kind','id'],properties:{kind:{type:'string',enum:['help','fact']},id:{type:'string'}}}}}};
// Citations outside the supplied sources are dropped: the model cannot point at data it was not given.
export function parseAssistantOutput(raw:unknown,sources:AssistantCitation[]|{kind:string;id:string}[]){
 const v=outputSchema.parse(raw);
 return{text:v.text,citations:v.citations.filter(c=>sources.some(s=>s.kind===c.kind&&s.id===c.id)) as AssistantCitation[]};
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
