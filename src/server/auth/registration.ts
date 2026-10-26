import 'server-only';
import { requireIdentity } from './principal.ts';
import { getPools } from '../db/pool.ts';
import { AppError } from '../errors.ts';
import { validateRegistration } from '../../domain/registration.ts';
export async function registrationSnapshot(headers:Headers) {
 const {user}=await requireIdentity(headers);
 const {rows:[row]}=await getPools().authPool.query('SELECT "registrationRequired","phoneNumber" FROM "user" WHERE id=$1',[user.id]);
 return {required:row?.registrationRequired===true,phone:row?.phoneNumber??''};
}
export async function completeRegistration(headers:Headers,input:unknown) {
 const {user}=await requireIdentity(headers);
 let data;
 try{data=validateRegistration(input);}catch(e){throw new AppError(422,e instanceof Error?e.message:'Cadastro inválido.');}
 // Single conditional write: a repeated request cannot replace an earlier acceptance.
 await getPools().authPool.query('UPDATE "user" SET "phoneNumber"=$2,"termsVersion"=$3,"privacyVersion"=$4,"legalAcceptedAt"=now(),"registrationRequired"=false,"updatedAt"=now() WHERE id=$1 AND "registrationRequired"=true',[user.id,data.phoneNumber,data.termsVersion,data.privacyVersion]);
 return {ok:true};
}
