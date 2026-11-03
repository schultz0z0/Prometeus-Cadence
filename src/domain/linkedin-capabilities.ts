import {z} from 'zod';
export type LinkedinMessageMode='unavailable'|'assisted'|'automatic';
export type LinkedinProfileAction='visit'|'like'|'comment';
export type LinkedinCapabilities={version:string;connect:boolean;audience:boolean;invite:boolean;acceptance:boolean;readMessages:boolean;sendMessage:LinkedinMessageMode;profileActions:LinkedinProfileAction[];verifiedAt:string|null};
export const NO_LINKEDIN:LinkedinCapabilities={version:'none',connect:false,audience:false,invite:false,acceptance:false,readMessages:false,sendMessage:'unavailable',profileActions:[],verifiedAt:null};
// Gate keys: what an executor asks for. A scheduled (cadence) message needs 'automatic'; a reply typed by the member needs only 'assisted'.
export const LINKEDIN_CAPABILITY_KEYS=['connect','audience','invite','acceptance','readMessages','sendMessage','scheduledMessage','profileVisit','like','comment'] as const;
export type LinkedinCapabilityKey=typeof LINKEDIN_CAPABILITY_KEYS[number];
export function linkedinMessageMode(input:{approved:boolean;humanActionRequired:boolean;canMessage:boolean}):LinkedinMessageMode{
 return !input.approved||!input.canMessage?'unavailable':input.humanActionRequired?'assisted':'automatic';
}
export function linkedinActionAllowed(c:LinkedinCapabilities,key:LinkedinCapabilityKey):boolean{
 switch(key){
  // Allow-list values only: a malformed stored profile must fail closed.
  case 'sendMessage':return c.sendMessage==='assisted'||c.sendMessage==='automatic';
  case 'scheduledMessage':return c.sendMessage==='automatic';
  case 'profileVisit':return Array.isArray(c.profileActions)&&c.profileActions.includes('visit');
  case 'like':case 'comment':return Array.isArray(c.profileActions)&&c.profileActions.includes(key);
  default:return c[key]===true;
 }
}
/** Every action the reference shows in the LinkedIn module, with the capability it needs. 'local' = no LinkedIn account action (central AI or local data). */
export const linkedinInventory:{id:string;label:string;evidence:string;capability:LinkedinCapabilityKey|'local'}[]=[
 {id:'connect-account',label:'Conectar o seu LinkedIn',evidence:'EV-238',capability:'connect'},
 {id:'audience-filters',label:'Público por cargo, local, setor e palavra-chave',evidence:'EV-241',capability:'audience'},
 {id:'audience-search-link',label:'Público por link de busca do LinkedIn',evidence:'EV-241',capability:'audience'},
 {id:'audience-post',label:'Público por engajamento em post',evidence:'EV-241',capability:'audience'},
 {id:'audience-explore',label:'Explorar público antes de ativar',evidence:'EV-241',capability:'audience'},
 {id:'ai-filters',label:'Montar filtros com IA',evidence:'EV-241',capability:'local'},
 {id:'ai-note',label:'Trecho da nota escrito pela IA',evidence:'EV-241',capability:'local'},
 {id:'invite-note',label:'Convite com nota de até 300 caracteres',evidence:'EV-241',capability:'invite'},
 {id:'invite-pace',label:'Convites por dia no horário comercial',evidence:'EV-241',capability:'invite'},
 {id:'invite-expiry',label:'Retirar convite depois de N dias',evidence:'EV-241',capability:'invite'},
 {id:'warm-visit',label:'Aquecimento: visitar o perfil',evidence:'EV-241',capability:'profileVisit'},
 {id:'warm-like',label:'Aquecimento: curtir um post',evidence:'EV-241',capability:'like'},
 {id:'acceptance-sync',label:'Aceite do convite vira pessoa e lista',evidence:'EV-242',capability:'acceptance'},
 {id:'pipeline-stages',label:'Pipeline por estágio do convite',evidence:'EV-243',capability:'acceptance'},
 {id:'enrich-on-accept',label:'E-mail e telefone do perfil no aceite',evidence:'EV-240',capability:'acceptance'},
 {id:'cadence-messages',label:'Cadência de mensagens para quem aceitou',evidence:'EV-236',capability:'scheduledMessage'},
 {id:'inbox-replies',label:'Resposta chega na caixa',evidence:'EV-238',capability:'readMessages'},
 {id:'manual-reply',label:'Responder a conversa',evidence:'EV-238',capability:'sendMessage'},
 {id:'post-comment',label:'Comentário em post aprovado por você',evidence:'EV-235',capability:'comment'},
 {id:'templates',label:'Templates de convite e mensagem',evidence:'EV-244',capability:'local'},
];
export function linkedinFeasibility(c:LinkedinCapabilities,reason:string){
 return linkedinInventory.map(a=>{const allowed=a.capability==='local'||linkedinActionAllowed(c,a.capability);return {...a,allowed,reason:allowed?'':reason};});
}
const MAX_DAYS=400;
export const capabilitiesSchema=z.object({version:z.string().trim().min(1).max(40),connect:z.boolean(),audience:z.boolean(),invite:z.boolean(),acceptance:z.boolean(),readMessages:z.boolean(),
 sendMessage:z.enum(['unavailable','assisted','automatic']),profileActions:z.array(z.enum(['visit','like','comment'])).max(3),verifiedAt:z.string().nullable()}).strict();
export const adapterIdSchema=z.string().regex(/^[a-z0-9][a-z0-9-]{1,59}$/);
export const attestationBase=z.object({
 adapterId:adapterIdSchema,kind:z.enum(['official','account-connector']),agreementRef:z.string().trim().min(3).max(300),
 expiresAt:z.string().datetime({offset:true}),capabilities:capabilitiesSchema,
 evidenceRefs:z.record(z.string(),z.array(z.string().trim().min(1).max(300)).min(1).max(10)),
});
export function refineAttestation(a:z.infer<typeof attestationBase>,ctx:z.RefinementCtx){
 const days=(Date.parse(a.expiresAt)-Date.now())/864e5;
 if(!(days>0&&days<=MAX_DAYS))ctx.addIssue({code:'custom',path:['expiresAt'],message:`A validade precisa estar entre agora e ${MAX_DAYS} dias.`});
 // LinkedIn Messages API requires a specific member action and excludes scheduled sends (BR-001, SRC-005).
 if(a.kind==='official'&&a.capabilities.sendMessage==='automatic')ctx.addIssue({code:'custom',path:['capabilities','sendMessage'],message:'A API oficial não permite mensagem automática ou agendada.'});
 const enabled=[...(['connect','audience','invite','acceptance','readMessages'] as const).filter(k=>a.capabilities[k]),...(a.capabilities.sendMessage!=='unavailable'?['sendMessage']:[]),...a.capabilities.profileActions];
 for(const k of enabled)if(!a.evidenceRefs[k]?.length)ctx.addIssue({code:'custom',path:['evidenceRefs',k],message:`Falta evidência para ${k}.`});
 for(const k of Object.keys(a.evidenceRefs))if(!enabled.includes(k))ctx.addIssue({code:'custom',path:['evidenceRefs',k],message:`Evidência para capacidade desligada: ${k}.`});
}
export const attestationSchema=attestationBase.strict().superRefine(refineAttestation);
export type AdapterAttestation=z.infer<typeof attestationSchema>;
export type LinkedinCapabilityView={capabilities:LinkedinCapabilities;adapter:{id:string;kind:'official'|'account-connector';expiresAt:string;revision:number}|null;reason:string;actions:ReturnType<typeof linkedinFeasibility>};
