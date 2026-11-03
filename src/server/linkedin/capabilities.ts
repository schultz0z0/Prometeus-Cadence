import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import {adapterIdSchema,attestationBase,capabilitiesSchema,refineAttestation,linkedinActionAllowed,linkedinFeasibility,NO_LINKEDIN,type LinkedinCapabilities,type LinkedinCapabilityKey,type LinkedinCapabilityView} from '../../domain/linkedin-capabilities.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {platformAiWorkspace} from '../prospecting/ai/platform.ts';
import {requireAiAdmin} from '../prospecting/ai/settings.ts';

const failures:Record<string,[number,string]>={
 PLATFORM_ADMIN_REQUIRED:[403,'Somente a administração da plataforma habilita o LinkedIn.'],
 REVISION_CONFLICT:[409,'O fornecedor do LinkedIn mudou em outra aba. Recarregue antes de continuar.'],
 ADAPTER_ACTIVE:[409,'Já existe um fornecedor do LinkedIn ativo. Revogue-o antes de habilitar outro.'],
 LINKEDIN_INVALID:[422,'A validade precisa estar entre agora e 400 dias.'],
};
// 23505: the single-active index caught what the advisory lock should have serialized.
const sqlError=(e:unknown)=>{const k=e instanceof Error?failures[(e as {code?:string}).code==='23505'?'ADAPTER_ACTIVE':e.message]:undefined;return k?new AppError(k[0],k[1],e instanceof Error?e.message:undefined):e;};
const reasons={none:'Nenhum fornecedor do LinkedIn está habilitado na plataforma.',expired:'A habilitação do fornecedor do LinkedIn venceu.',revoked:'O fornecedor do LinkedIn foi revogado.',missing:'O fornecedor habilitado não oferece esta ação.',invalid:'A habilitação do fornecedor do LinkedIn está inválida.'};
type State={adapterId:string;kind:'official'|'account-connector';capabilities:unknown;expiresAt:string;verifiedAt:string;revision:number|string;state:'active'|'expired'|'revoked'}|null;

export async function linkedinCapabilityView(c:PoolClient):Promise<LinkedinCapabilityView>{
 const s=(await c.query('SELECT app.linkedin_capability_state() s')).rows[0].s as State;
 const stored=s?.state==='active'?capabilitiesSchema.safeParse(s.capabilities):null;
 if(s?.state!=='active'||!stored?.success){const reason=reasons[!s?'none':s.state==='active'?'invalid':s.state];return {capabilities:NO_LINKEDIN,adapter:null,reason,actions:linkedinFeasibility(NO_LINKEDIN,reason)};}
 const capabilities:LinkedinCapabilities={...stored.data,verifiedAt:new Date(s.verifiedAt).toISOString()};
 return {capabilities,adapter:{id:s.adapterId,kind:s.kind,expiresAt:new Date(s.expiresAt).toISOString(),revision:Number(s.revision)},reason:'',actions:linkedinFeasibility(capabilities,reasons.missing)};
}
export const readLinkedinCapabilities=(p:Principal)=>withWorkspaceTransaction(p,linkedinCapabilityView);
/** Gate every LinkedIn executor calls before and after each I/O; it reads the attestation in the caller's transaction, so expiry and revocation apply at once. */
export async function requireLinkedinCapability(c:PoolClient,key:LinkedinCapabilityKey){
 const v=await linkedinCapabilityView(c);if(!linkedinActionAllowed(v.capabilities,key))throw new AppError(409,v.reason||reasons.missing,'LINKEDIN_UNAVAILABLE');
}
const scope=()=>{const s=platformAiWorkspace();if(!s)throw new AppError(403,failures.PLATFORM_ADMIN_REQUIRED[1],'PLATFORM_ADMIN_REQUIRED');return s;};
const attestInput=attestationBase.extend({expectedRevision:z.number().int().min(0)}).strict().superRefine(refineAttestation);
export async function attestLinkedinAdapter(p:Principal,input:unknown){
 const parsed=attestInput.safeParse(input);if(!parsed.success)throw new AppError(422,parsed.error.issues[0]?.message??'Habilitação inválida.');
 const a=parsed.data;
 return withWorkspaceTransaction(p,async c=>{await requireAiAdmin(c);
  await c.query('SELECT app.attest_linkedin_adapter($1,$2,$3,$4,$5,$6,$7,$8)',[scope(),a.adapterId,a.kind,a.agreementRef,{...a.capabilities,verifiedAt:null},a.evidenceRefs,a.expiresAt,a.expectedRevision]).catch(e=>{throw sqlError(e);});
  return linkedinCapabilityView(c);});
}
const revokeInput=z.object({adapterId:adapterIdSchema,expectedRevision:z.number().int().min(1)}).strict();
export async function revokeLinkedinAdapter(p:Principal,input:unknown){
 const parsed=revokeInput.safeParse(input);if(!parsed.success)throw new AppError(422,'Revogação inválida.');
 return withWorkspaceTransaction(p,async c=>{await requireAiAdmin(c);
  await c.query('SELECT app.revoke_linkedin_adapter($1,$2,$3)',[scope(),parsed.data.adapterId,parsed.data.expectedRevision]).catch(e=>{throw sqlError(e);});
  return linkedinCapabilityView(c);});
}
