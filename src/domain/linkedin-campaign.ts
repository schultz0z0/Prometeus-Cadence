import {z} from 'zod';
import {linkedinActionAllowed,type LinkedinCapabilities} from './linkedin-capabilities.ts';
// 07A.2: invite campaigns on the customer's own LinkedIn account (Unipile). Every control of the editor (EV-241) is in the draft.
// Own conservative ceiling, not a LinkedIn policy nor a promise the account is safe.
export const LINKEDIN_DAILY_CAP=12;
export const NOTE_TOKENS=['{nome}','{empresa}','{cargo}','{setor}','{prova}'] as const;
const label=z.string().trim().min(1).max(80);
const linkedinUrl=z.url({protocol:/^https$/}).max(2000);
export const campaignSourceSchema=z.strictObject({
 mode:z.enum(['filters','url','post']),description:z.string().max(500),
 roles:z.array(label).max(5),locations:z.array(label).max(10),industries:z.array(label).max(10),keyword:z.string().trim().max(100),
 searchUrl:linkedinUrl.or(z.literal('')),postUrl:linkedinUrl.or(z.literal('')),
 degrees:z.array(z.union([z.literal(2),z.literal(3)])).min(1).max(2),
});
export const campaignDraftSchema=z.strictObject({
 name:z.string().trim().min(1).max(100),source:campaignSourceSchema,decisionMakerOnly:z.boolean(),
 proof:z.string().max(200),extraProof:z.string().max(200),
 note:z.string().max(300).refine(n=>(n.match(/\{[^}]*\}/g)??[]).every(t=>(NOTE_TOKENS as readonly string[]).includes(t)),'Use só {nome}, {empresa}, {cargo}, {setor} ou {prova}.'),
 dailyLimit:z.number().int().min(1).max(LINKEDIN_DAILY_CAP),expireDays:z.number().int().min(1).max(365),
 warming:z.boolean(),enrichOnAccept:z.boolean(),otherList:z.enum(['none','new']),
});
export type CampaignSource=z.infer<typeof campaignSourceSchema>;
export type LinkedinCampaignDraft=z.infer<typeof campaignDraftSchema>;
export type CampaignState='draft'|'active'|'paused'|'completed'|'cancelled';
export type CampaignPersonState='queued'|'sending'|'invited'|'accepted'|'expired'|'skipped'|'failed'|'uncertain';
export interface LinkedinCampaignView{id:string;name:string;state:CampaignState;revision:number;draft:LinkedinCampaignDraft;acceptListId:string|null;otherListId:string|null;counts:Partial<Record<CampaignPersonState,number>>;collectDone:boolean;lastError:string|null;updatedAt:string}
export interface AudienceSample{name:string;headline:string;location:string;degree:number|null}
export const defaultCampaignDraft=():LinkedinCampaignDraft=>({name:'',source:{mode:'filters',description:'',roles:[],locations:[],industries:[],keyword:'',searchUrl:'',postUrl:'',degrees:[2,3]},
 decisionMakerOnly:true,proof:'',extraProof:'',note:'',dailyLimit:LINKEDIN_DAILY_CAP,expireDays:30,warming:true,enrichOnAccept:false,otherList:'none'});
export const linkedinInviteEligible=(i:{connectedAlready:boolean;pendingInvite:boolean;approved:boolean})=>!i.connectedAlready&&!i.pendingInvite&&i.approved;
/** Fills the note only with facts from the profile; a missing fact (or a note over 300 characters) means this person is skipped. */
export function renderInviteNote(note:string,vars:Partial<Record<'nome'|'empresa'|'cargo'|'setor'|'prova',string>>):string|null{
 let missing=false;
 const out=note.replace(/\{(nome|empresa|cargo|setor|prova)\}/g,(_,k:keyof typeof vars)=>{const v=vars[k]?.trim();if(!v){missing=true;return '';}return v;});
 return missing||out.length>300?null:out;
}
const brt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',weekday:'short',hour:'numeric',hourCycle:'h23'});
/** Weekdays, 9h to 18h in Brasília. */
export function inviteWindowOpen(at:Date){
 const parts=Object.fromEntries(brt.formatToParts(at).map(p=>[p.type,p.value]));
 return !['Sat','Sun'].includes(parts.weekday)&&Number(parts.hour)>=9&&Number(parts.hour)<18;
}
export function campaignBlockers(d:LinkedinCampaignDraft,ctx:{accountReady:boolean;capabilities:LinkedinCapabilities}):string[]{
 const out:string[]=[],c=ctx.capabilities;
 if(!ctx.accountReady)out.push('Conecte uma conta LinkedIn pronta antes de ativar.');
 if(!(['audience','invite','acceptance'] as const).every(k=>linkedinActionAllowed(c,k)))out.push('O fornecedor habilitado ainda não oferece busca, convite e aceite.');
 // shortcut: warming has no executor yet, so it always blocks; wire visit/like (capabilities profileVisit, like) before lifting this.
 if(d.warming)out.push('O aquecimento social ainda não está disponível. Desmarque-o para ativar.');
 if(d.decisionMakerOnly)out.push('A triagem de decisor ainda não está disponível. Desmarque-a para ativar.');
 return out;
}
export function parsePostId(raw:string):string|null{
 const u=URL.parse(raw);if(!u||u.protocol!=='https:'||!/(^|\.)linkedin\.com$/.test(u.hostname))return null;
 return u.pathname.match(/(?:activity[-:])(\d{10,25})/)?.[1]??null;
}
export function isPeopleSearchUrl(raw:string){const u=URL.parse(raw);return !!u&&u.protocol==='https:'&&/(^|\.)linkedin\.com$/.test(u.hostname)&&/^\/(search\/results\/people|sales\/search\/people)\/?$/.test(u.pathname);}
export const degreeOf=(d:unknown)=>({DISTANCE_1:1,DISTANCE_2:2,DISTANCE_3:3} as Record<string,number>)[String(d)]??null;
