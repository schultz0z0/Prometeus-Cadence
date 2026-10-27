import {z} from 'zod';
import type {Lead} from './model.ts';
import type {LeadQuery} from './leads.ts';
const text=z.string().trim().max(250),day=z.iso.date();
const schema=z.strictObject({search:text.optional(),listId:text.optional(),qualification:z.enum(['','qualified','pending','warning','disqualified']).optional(),onlyFavorites:z.enum(['true','false']).optional(),contact:z.enum(['','email','phone','none']).optional(),state:z.string().max(50).optional(),source:z.enum(['','MAPS','WEB','CNPJ','APOLLO','QUALIFY','REENGAGE','MANUAL']).optional(),createdFrom:day.optional(),createdTo:day.optional(),summary:z.enum(['','yes','no']).optional(),cadenceId:text.optional(),reply:z.enum(['','yes','no']).optional(),optOut:z.enum(['','yes','no']).optional(),enriched:z.enum(['','yes','no']).optional(),sort:z.enum(['name','city','newest']).default('newest'),page:z.coerce.number().int().min(1).max(5000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).refine(q=>!q.createdFrom||!q.createdTo||q.createdFrom<=q.createdTo);
export type ContactsQuery=LeadQuery&{page:number;pageSize:number;cadenceId?:string;reply?:'yes'|'no'|'';optOut?:'yes'|'no'|'';enriched?:'yes'|'no'|''};
export interface ContactsPage{items:Lead[];total:number;page:number;pageSize:number;revision:number;cadences:Record<string,string>}
export function parseContactsQuery(params:URLSearchParams):ContactsQuery{
 for(const key of params.keys())if(params.getAll(key).length>1)throw Error('Consulta de contatos inválida.');
 const q=schema.parse(Object.fromEntries(params));return {...q,onlyFavorites:q.onlyFavorites==='true'};
}
