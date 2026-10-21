import {z} from 'zod';
import {contextFields,type PlanningEvidence,type PlanningTask} from '../../domain/planning.ts';
import {generationSchema,idSchema} from '../prospecting/schemas.ts';
const brief=z.string().trim().max(4000);
const timezone=z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}});
const channel=z.enum(['EMAIL','WHATSAPP']);
export const planningInputSchema=z.discriminatedUnion('task',[
 z.strictObject({kind:z.literal('planning'),task:z.literal('context_read'),domain:z.string().trim().min(1).max(253),target:z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('company')}),z.strictObject({kind:z.literal('product'),productId:idSchema})])}),
 z.strictObject({kind:z.literal('planning'),task:z.literal('audience_plan'),description:brief,channel:z.enum(['email','whatsapp','both']),productId:idSchema.optional(),timezone}),
 z.strictObject({kind:z.literal('planning'),task:z.literal('cadence_options'),listId:idSchema,objective:z.string().min(1).max(100),channels:z.array(channel).min(1).max(2).refine(v=>new Set(v).size===v.length),tone:z.string().min(1).max(100),rhythm:z.string().min(1).max(100),highlight:brief,avoid:brief,decisionMaker:brief,productId:idSchema.optional()}),
 z.strictObject({kind:z.literal('planning'),task:z.literal('message_preview'),cadenceId:idSchema,stepId:idSchema,leadId:idSchema,productId:idSchema.optional()}),
]);
export const planningEvidenceSchema=z.strictObject({id:idSchema,kind:z.enum(['public_page','approved_context','user_brief','lead_fact']),url:z.url().max(2048).nullable(),text:z.string().max(12000),hash:z.string().regex(/^[a-f0-9]{64}$/),obtainedAt:z.iso.datetime()});
export const supportedFieldSchema=z.strictObject({value:z.string().max(4000),evidenceIds:z.array(idSchema).max(3).refine(v=>new Set(v).size===v.length),quote:z.string().max(360)});
const normalize=(v:string)=>v.replace(/\s+/g,' ').trim();
export function validateFieldSupport(value:unknown,sources:PlanningEvidence[]):boolean{
 const field=supportedFieldSchema.safeParse(value);if(!field.success)return false;
 const f=field.data;if(!f.value.trim())return f.evidenceIds.length===0&&f.quote==='';
 if(!f.evidenceIds.length||!normalize(f.quote))return false;
 return f.evidenceIds.every(id=>sources.some(s=>s.id===id&&normalize(s.text).includes(normalize(f.quote))));
}
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const schedule=z.strictObject({frequency:z.literal('daily'),time,timezone,weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v=>new Set(v).size===v.length)});
const modules=z.array(z.enum(['email','phone','website','summary','deep','validateEmail','registry','qualify'])).min(1).max(8).refine(v=>new Set(v).size===v.length);
const audience=z.strictObject({id:z.enum(['option_1','option_2','option_3']),title:z.string().trim().min(1).max(160),description:brief,listName:z.string().trim().min(2).max(100),source:z.enum(['MAPS','WEB','CNPJ','APOLLO']),filters:z.record(z.string(),z.string()),channel:z.enum(['email','whatsapp','both']),marketSize:z.null(),dailyLimit:z.number().int().min(1).max(500),modules,criteria:brief,schedules:z.strictObject({search:schedule,qualification:schedule})}).superRefine((v,c)=>{
 const parsed=generationSchema.safeParse({kind:'generation',source:v.source,filters:v.filters,destination:{mode:'new',name:v.listName},limit:v.dailyLimit,dedupScope:'workspace'});
 if(!parsed.success)c.addIssue({code:'custom',message:'Filtros de fonte inválidos.'});
});
const variables=new Set(['nome','email','telefone','site','cidade','razaoSocial','cnpj']);
function validVariables(v:string){return Array.from(v.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)).every(m=>variables.has(m[1]));}
export const planningStepSchema=z.strictObject({channel,delayDays:z.number().int().min(0).max(365),subject:z.string().max(200).refine(validVariables).optional(),body:z.string().trim().min(1).max(2000).refine(validVariables),aiInstructions:brief.optional(),stopOnReply:z.literal(true)}).superRefine((v,c)=>{if(v.channel==='EMAIL'&&!v.subject?.trim())c.addIssue({code:'custom',message:'E-mail exige assunto.'});});
const cadence=z.strictObject({id:z.enum(['option_1','option_2','option_3']),name:z.string().trim().min(1).max(160),description:brief,steps:z.array(planningStepSchema).length(3)});
export const audienceOptionSchema=audience;
export const cadenceOptionSchema=cadence;
function optionsSchema<T extends z.ZodType>(option:T,key:(o:z.output<T>)=>unknown){return z.strictObject({options:z.array(option).length(3)}).superRefine((v,c)=>{
 if(new Set(v.options.map(o=>(o as {id:string}).id)).size!==3||new Set(v.options.map(o=>JSON.stringify(key(o)))).size!==3)c.addIssue({code:'custom',message:'Retorne três opções diferentes.'});
});}
const resultSchemas={
 context_read:z.strictObject({fields:z.partialRecord(z.enum(contextFields),supportedFieldSchema)}),
 audience_plan:optionsSchema(audience,o=>({source:o.source,filters:o.filters,criteria:o.criteria})),
 cadence_options:optionsSchema(cadence,o=>o.steps),
 message_preview:z.strictObject({body:z.string().trim().min(1).max(2000).refine(validVariables),subject:z.string().max(200).refine(validVariables).optional(),evidenceIds:z.array(idSchema).max(20)}),
};
export function validatePlanningResult(task:PlanningTask,value:unknown,sources:PlanningEvidence[]){
 return resultSchemas[task].superRefine((v,c)=>{
   if(sources.some(s=>!planningEvidenceSchema.safeParse(s).success)||new Set(sources.map(s=>s.id)).size!==sources.length||sources.filter(s=>s.kind==='public_page').length>3)c.addIssue({code:'custom',message:'Fontes inválidas.'});
   if('fields' in v)for(const f of Object.values(v.fields))if(f&&!validateFieldSupport(f,sources.filter(s=>s.kind==='public_page')))c.addIssue({code:'custom',message:'Campo sem suporte literal nas fontes.'});
   if('evidenceIds' in v&&v.evidenceIds.some(id=>!sources.some(s=>s.id===id)))c.addIssue({code:'custom',message:'Referência de fonte inválida.'});
 }).safeParse(value);
}
