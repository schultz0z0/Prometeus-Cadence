import {z} from 'zod';
export const idSchema=z.string().min(1).max(120).refine(v=>!/[\x00-\x1f]/.test(v));
const filters=z.record(z.string().max(40),z.string().max(1000));
const allowedFilters:Record<string,Set<string>>={
  MAPS:new Set(['term','location']),WEB:new Set(['term','location']),
  CNPJ:new Set(['term','location','active','email','phone','noAccountant','openedAfter','openedBefore','includeCnae','excludeCnae','excludeEmail','excludeDomains','includeName','excludeName','states','size','legal','mei','minCapital','maxCapital','headOffice','neighborhood','zip','cnae','state','city','cnpj']),
  APOLLO:new Set(['term','location','industry','minEmployees','maxEmployees','domains']),
};
export const generationSchema=z.strictObject({kind:z.literal('generation'),source:z.enum(['MAPS','WEB','CNPJ','APOLLO']),destination:z.discriminatedUnion('mode',[z.strictObject({mode:z.literal('new'),name:z.string().trim().min(2).max(100)}),z.strictObject({mode:z.literal('existing'),listId:idSchema})]),filters,limit:z.number().int().min(1).max(500),dedupScope:z.enum(['list','workspace'])}).superRefine((v,c)=>{
  for(const key of Object.keys(v.filters))if(!allowedFilters[v.source].has(key))c.addIssue({code:'custom',path:['filters',key],message:'Filtro desconhecido.'});
  if(!v.filters.term?.trim())c.addIssue({code:'custom',path:['filters','term'],message:'Informe o público.'});
  if(['MAPS','WEB'].includes(v.source)&&!v.filters.location?.trim())c.addIssue({code:'custom',path:['filters','location'],message:'Informe a localização.'});
});
const qualification=z.strictObject({kind:z.literal('qualification'),listId:idSchema,leadIds:z.array(idSchema).min(1).max(500).refine(v=>new Set(v).size===v.length),modules:z.array(z.enum(['email','phone','website','summary','deep','validateEmail','registry','qualify'])).min(1).max(8).refine(v=>new Set(v).size===v.length),summaryPolicy:z.enum(['all','fits']),escalation:z.enum(['off','ambiguous'])});
export const jobInputSchema=z.discriminatedUnion('kind',[generationSchema,qualification]);
export const confirmationSchema=z.strictObject({requestId:z.uuid(),input:jobInputSchema,reviewToken:z.string().min(1).max(8192)});
export const pageSchema=z.strictObject({cursor:z.string().max(1000).optional(),limit:z.coerce.number().int().min(1).max(100).default(25)});
