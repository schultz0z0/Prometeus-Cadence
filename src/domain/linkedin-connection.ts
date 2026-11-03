import {z} from 'zod';
import type {LinkedinCapabilities} from './linkedin-capabilities.ts';
// 07A.1: the customer's own LinkedIn account, operated through the platform's account connector (Unipile).
export type LinkedinAccountState='connecting'|'ready'|'restricted'|'revoked'|'error';
export interface LinkedinAccountView{id:string;displayName:string;state:LinkedinAccountState;capabilities:LinkedinCapabilities;lastSyncAt:string|null;revision:number;ready:boolean;attention:string|null}
/** Ready only while connected, not revoked and verified against the attestation in force; a re-attestation voids it until the next check. */
export function linkedinAccountReady(i:{connected:boolean;revoked:boolean;capabilitiesVersionMatches:boolean}){return i.connected&&!i.revoked&&i.capabilitiesVersionMatches;}
// Worst first: a reconnect fixes credentials, so say that before a generic error.
const order:[string[],LinkedinAccountState][]=[[['CREDENTIALS','PERMISSIONS'],'restricted'],[['ERROR','STOPPED'],'error'],[['CONNECTING'],'connecting']];
export function unipileSourcesState(statuses:string[]):LinkedinAccountState{
 if(!statuses.length||statuses.some(s=>!['OK','CREDENTIALS','PERMISSIONS','ERROR','STOPPED','CONNECTING'].includes(s)))return 'error';
 return order.find(([keys])=>statuses.some(s=>keys.includes(s)))?.[1]??'ready';
}
const SIX_HOURS=6*3600e3;
/** Next check after `failures` consecutive failures (0 = after a success). */
export const linkedinSyncDelayMs=(failures:number)=>failures<=0?SIX_HOURS:Math.min(SIX_HOURS,5*60e3*2**(failures-1));
export const attentionFor:Record<LinkedinAccountState,string|null>={
 ready:null,connecting:'O fornecedor ainda está conectando a conta. Verifique de novo em instantes.',
 restricted:'O LinkedIn pediu um novo login ou restringiu a conta. Reconecte para continuar.',
 error:'A sincronização da conta parou. Verifique de novo ou reconecte.',revoked:null,
};
// shortcut: draft wording pending a legal reading (STATUS "Needs human"); bump the version when it changes so everyone accepts again.
export const LINKEDIN_TERMS={version:'2026-11-03-rascunho',title:'Antes de conectar o seu LinkedIn',items:[
 'O Prometeus opera a sua própria conta LinkedIn por um fornecedor de conexão (Unipile). O LinkedIn não aprova esse tipo de automação, e o Contrato do Usuário dele proíbe bots e envios automatizados.',
 'O LinkedIn pode pedir um novo login, limitar ou restringir a sua conta. Esse risco é da conta que você conecta.',
 'Você faz o login na página do fornecedor. O Prometeus não vê nem guarda a sua senha.',
 'Nada é enviado só por conectar. Convites e mensagens dependem de campanhas que você revisa, e o ritmo fica abaixo dos limites do LinkedIn.',
 'Você pode desconectar quando quiser: o acesso para na hora e a sessão é removida do fornecedor.',
]};
export const unipileAccountId=z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);
export const confirmConnectSchema=z.strictObject({termsVersion:z.string().min(1).max(40),acceptTerms:z.literal(true),expectedRevision:z.number().int().min(0),accountId:z.uuid().optional()});
// The vendor may add fields; only these are read.
export const notifySchema=z.object({status:z.enum(['CREATION_SUCCESS','RECONNECTED']),account_id:unipileAccountId,name:z.string().min(1).max(100)});
