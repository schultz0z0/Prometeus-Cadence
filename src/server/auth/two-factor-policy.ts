import'server-only';
import{createHash,createHmac,randomUUID,timingSafeEqual}from'node:crypto';import{z}from'zod';import type{PoolClient}from'pg';import{makeSignature}from'better-auth/crypto';
import{getAuth}from'./auth.ts';import{requireIdentity}from'./principal.ts';import{getPools}from'../db/pool.ts';import{AppError}from'../errors.ts';import{totpVerificationSchema}from'../../domain/security-policy.ts';
const passwordInput=z.strictObject({password:z.string().max(128)}),disableInput=z.strictObject({password:z.string().max(128),code:z.string().regex(/^[0-9]{6}$/)}),loginInput=z.strictObject({code:z.string().min(6).max(32),backup:z.boolean()});
const invalid=()=>new AppError(401,'Código ou desafio inválido. Entre novamente se o prazo terminou.');
const fingerprint=(secret:string)=>createHash('sha256').update(secret).digest('hex');
function parsed<T>(schema:z.ZodType<T>,input:unknown):T{const p=schema.safeParse(input);if(!p.success)throw new AppError(422,'Confira os dados de segurança informados.');return p.data;}
function appendCookies(from:Headers,to:Headers){for(const value of from.getSetCookie())to.append('set-cookie',value);}
async function responseToken(response:Response,fallback:string){const name=(await getAuth().$context).authCookies.sessionToken.name;for(const raw of response.headers.getSetCookie().toReversed()){if(!raw.startsWith(name+'='))continue;const value=decodeURIComponent(raw.split(';')[0].slice(name.length+1)),dot=value.lastIndexOf('.');if(dot>0)return value.slice(0,dot);}return fallback;}
async function native(response:Response){if(!response.ok)throw new AppError([400,401,403,409,429].includes(response.status)?response.status:503,response.status===429?'Aguarde um momento antes de tentar novamente.':'Não foi possível confirmar a operação. Confira sua senha e o código.');return response.json();}
async function userLock<T>(uid:string,action:(c:PoolClient)=>Promise<T>):Promise<T>{const c=await getPools().authPool.connect();try{await c.query("SELECT pg_advisory_lock(hashtextextended('factor:'||$1,0))",[uid]);return await action(c);}finally{try{await c.query("SELECT pg_advisory_unlock(hashtextextended('factor:'||$1,0))",[uid]);}finally{c.release();}}}
async function limit(c:PoolClient,uid:string,action:string){const r=(await c.query("INSERT INTO factor_rate(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN factor_rate.started_at<clock_timestamp()-interval '1 minute' THEN 1 ELSE factor_rate.attempts+1 END,started_at=CASE WHEN factor_rate.started_at<clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE factor_rate.started_at END RETURNING attempts",[uid+':'+action])).rows[0];if(r.attempts>5)throw new AppError(429,'Aguarde um minuto antes de tentar novamente.');}
async function state(c:PoolClient,uid:string){return(await c.query('SELECT u.security_epoch,u."twoFactorEnabled",f.id factor_id,f.secret,f.verified FROM "user" u LEFT JOIN "twoFactor" f ON f."userId"=u.id WHERE u.id=$1',[uid])).rows[0];}
async function active(c:PoolClient,uid:string,sid:string){return(await c.query('SELECT "createdAt","twoFactorVerified" FROM session WHERE id=$1 AND "userId"=$2 AND "expiresAt">clock_timestamp()',[sid,uid])).rows[0];}
async function consumeCode(c:PoolClient,uid:string,hash:string,code:string){const digest=createHmac('sha256',process.env.BETTER_AUTH_SECRET!).update(uid+'\0'+hash+'\0'+code).digest('hex');const r=await c.query("INSERT INTO totp_use(user_id,factor_hash,code_hash) VALUES($1,$2,$3) ON CONFLICT(user_id,factor_hash,code_hash) DO UPDATE SET used_at=clock_timestamp() WHERE totp_use.used_at<clock_timestamp()-interval '2 minutes' RETURNING user_id",[uid,hash,digest]);if(!r.rowCount)throw new AppError(409,'Este código já foi utilizado. Aguarde o próximo código e entre novamente.','TOTP_REPLAY');}
async function challengeIdentity(headers:Headers){
 const session=await getAuth().api.getSession({headers});if(session)return{userId:session.user.id,sessionId:session.session.id};
 const secure=new URL(process.env.BETTER_AUTH_URL!).protocol==='https:',name=(secure?'__Secure-':'')+'better-auth.two_factor';let signed:string|undefined;
 try{signed=(headers.get('cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'=')).map(v=>decodeURIComponent(v.slice(name.length+1)))[0];}catch{throw invalid();}
 if(!signed||signed.length>512)throw invalid();const pos=signed.lastIndexOf('.'),value=signed.slice(0,pos),signature=signed.slice(pos+1),expected=await makeSignature(value,process.env.BETTER_AUTH_SECRET!);
 if(pos<1||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw invalid();
 const row=(await getPools().authPool.query('SELECT value FROM verification WHERE identifier=$1 AND "expiresAt">clock_timestamp()',[value])).rows[0];if(!row)throw invalid();return{userId:row.value as string,sessionId:null,identifier:value};
}
export async function prepareTotp(headers:Headers,input:{password:string}){
 const body=parsed(passwordInput,input),identity=await requireIdentity(headers);return userLock(identity.user.id,async c=>{
  const before=await state(c,identity.user.id),session=await active(c,identity.user.id,identity.session.id);if(!session)throw invalid();await limit(c,identity.user.id,'prepare');
  if(before.twoFactorEnabled||before.verified)throw new AppError(409,'O autenticador já está ativado.');
  const credential=await c.query('SELECT 1 FROM account WHERE "userId"=$1 AND "providerId"=\'credential\' AND password IS NOT NULL',[identity.user.id]);
  if(!credential.rowCount&&Date.now()-new Date(session.createdAt).getTime()>300000)throw new AppError(403,'Entre novamente com Google antes de configurar o autenticador.','FRESH_AUTH_REQUIRED');
  const response=await getAuth().api.enableTwoFactor({headers,body:{password:body.password,method:'totp'},asResponse:true}),data=await native(response),after=await state(c,identity.user.id);
  if(!await active(c,identity.user.id,identity.session.id)||before.security_epoch!==after.security_epoch)throw invalid();
  await c.query('DELETE FROM security_challenge WHERE user_id=$1',[identity.user.id]);const challengeId=randomUUID();await c.query("INSERT INTO security_challenge(id,user_id,session_id,factor_id,factor_hash,security_epoch,expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '5 minutes')",[challengeId,identity.user.id,identity.session.id,after.factor_id,fingerprint(after.secret),after.security_epoch]);
  return{challengeId,uri:data.totpURI as string,backupCodes:data.backupCodes as string[]};
 });
}
export async function verifyTotp(headers:Headers,input:{challengeId:string;code:string},outputHeaders=new Headers()){
 const body=parsed(totpVerificationSchema,input),identity=await requireIdentity(headers);return userLock(identity.user.id,async c=>{
  const before=await state(c,identity.user.id);await limit(c,identity.user.id,'setup-verify');
  const ch=(await c.query('UPDATE security_challenge SET attempts=attempts+1 WHERE id=$1 AND user_id=$2 AND session_id=$3 AND verified_at IS NULL AND expires_at>clock_timestamp() AND attempts<5 RETURNING *',[body.challengeId,identity.user.id,identity.session.id])).rows[0];
  if(!ch||!await active(c,identity.user.id,identity.session.id)||ch.security_epoch!==before.security_epoch||ch.factor_hash!==fingerprint(before.secret))throw new AppError(409,'O pareamento venceu ou mudou. Inicie novamente.');
  const response=await getAuth().api.verifyTOTP({headers,body:{code:body.code,trustDevice:false},asResponse:true}),data=await native(response);
  const token=await responseToken(response,data.token);await finish(c,identity.user.id,before,body.code,false,token,identity.session.id);await c.query('UPDATE security_challenge SET verified_at=clock_timestamp() WHERE id=$1',[ch.id]);
  await c.query('DELETE FROM session WHERE "userId"=$1 AND token<>$2',[identity.user.id,token]);appendCookies(response.headers,outputHeaders);return{enabled:true};
 });
}
async function finish(c:PoolClient,uid:string,before:Record<string,any>,code:string,backup:boolean,token:string,previousSession:string|null){
 try{const current=await state(c,uid);if(!current?.twoFactorEnabled||!current.verified||current.security_epoch!==before.security_epoch||fingerprint(current.secret)!==fingerprint(before.secret))throw invalid();
  if(!backup)await consumeCode(c,uid,fingerprint(current.secret),code);
  const marked=await c.query('UPDATE session SET "twoFactorVerified"=true WHERE token=$1 AND "userId"=$2 AND "expiresAt">clock_timestamp() RETURNING id',[token,uid]);if(!marked.rowCount)throw invalid();
 }catch(e){await c.query('DELETE FROM session WHERE token=$1 AND "userId"=$2 AND (id<>$3 OR "twoFactorVerified" IS DISTINCT FROM true)',[token,uid,previousSession??'']);throw e;}
}
export async function completeSecondFactor(headers:Headers,input:{code:string;backup:boolean},outputHeaders=new Headers()){
 const body=parsed(loginInput,input);if(!body.backup&&!/^[0-9]{6}$/.test(body.code))throw new AppError(422,'Informe os seis dígitos do autenticador.');const identity=await challengeIdentity(headers);
 return userLock(identity.userId,async c=>{const again=await challengeIdentity(headers);if(again.userId!==identity.userId)throw invalid();const before=await state(c,identity.userId);if(!before?.twoFactorEnabled||!before.verified)throw invalid();if(identity.sessionId&&!await active(c,identity.userId,identity.sessionId))throw invalid();await limit(c,identity.userId,'login');
  const response=body.backup?await getAuth().api.verifyBackupCode({headers,body:{code:body.code,trustDevice:false},asResponse:true}):await getAuth().api.verifyTOTP({headers,body:{code:body.code,trustDevice:false},asResponse:true}),data=await native(response);
  await finish(c,identity.userId,before,body.code,body.backup,await responseToken(response,data.token),identity.sessionId);appendCookies(response.headers,outputHeaders);return{ok:true};
 });
}
export async function disableTotp(headers:Headers,input:{password:string;code:string},outputHeaders=new Headers()){
 const body=parsed(disableInput,input),identity=await requireIdentity(headers);return userLock(identity.user.id,async c=>{
  await limit(c,identity.user.id,'disable');const before=await state(c,identity.user.id);if(!before?.twoFactorEnabled)throw new AppError(409,'O autenticador já está desativado.');
  const proof=await getAuth().api.verifyTOTP({headers,body:{code:body.code,trustDevice:false},asResponse:true});await native(proof);await consumeCode(c,identity.user.id,fingerprint(before.secret),body.code);
  const response=await getAuth().api.disableTwoFactor({headers,body:{password:body.password},asResponse:true});await native(response);await invalidateFactorChallenges(c,identity.user.id);await c.query('DELETE FROM session WHERE "userId"=$1',[identity.user.id]);appendCookies(response.headers,outputHeaders);return{enabled:false};
 });
}
export async function invalidateFactorChallenges(c:Pick<PoolClient,'query'>,uid:string){await c.query('DELETE FROM security_challenge WHERE user_id=$1',[uid]);await c.query("DELETE FROM verification WHERE value=$1 AND identifier LIKE '2fa-%'",[uid]);}
