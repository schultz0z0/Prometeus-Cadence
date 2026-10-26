import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { getPools } from '../../src/server/db/pool.ts';
import { base, registration, requestAuth, resetRateLimits, uniqueEmail, verifiedUser } from './helpers.ts';
import { registrationSnapshot, completeRegistration } from '../../src/server/auth/registration.ts';
import { identityAction } from '../../src/server/workspaces/service.ts';
import { randomUUID } from 'node:crypto';
import {getAuth,handleAuthRequest} from '../../src/server/auth/auth.ts';
after(async()=>getPools().close());
test('public signup rejects missing/current consent and persists server-owned metadata without activation',async()=>{
 await resetRateLimits();
 const email=uniqueEmail(), input={name:'Entry QA',email,password:'Local-entry-123456!'};
 for(const invalid of [undefined,{...registration,accepted:false},{...registration,termsVersion:'old'},{...registration,phone:'123'}])
   assert.equal((await requestAuth('sign-up/email',{...input,registration:invalid})).status,400);
 assert.equal((await getPools().authPool.query('SELECT id FROM "user" WHERE email=$1',[email])).rowCount,0);
 const response=await requestAuth('sign-up/email',{...input,registration,legalAcceptedAt:'1990-01-01'});
 assert.equal(response.status,400,'protected field cannot be injected');
 assert.equal((await requestAuth('sign-up/email',{...input,registration})).status,200);
 const {rows:[u]}=await getPools().authPool.query('SELECT * FROM "user" WHERE email=$1',[email]);
 assert.equal(u.phoneNumber,'+5521973231943');assert.equal(u.termsVersion,registration.termsVersion);assert.equal(u.privacyVersion,registration.privacyVersion);
 assert.ok(Date.now()-new Date(u.legalAcceptedAt).getTime()<60000);assert.equal(u.registrationRequired,false);assert.equal(u.emailVerified,false);
 assert.equal((await getPools().authPool.query('SELECT id FROM member WHERE "userId"=$1',[u.id])).rowCount,0,'no workspace or subscription created');
});
test('profile completion requires verification, gates new social identities and is immutable on repeat',async()=>{
 await resetRateLimits();const actor=await verifiedUser(),headers=new Headers({cookie:actor.cookie});
 // Represent a newly created social identity; no network OAuth in isolated tests.
 await getPools().authPool.query('UPDATE "user" SET "registrationRequired"=true,"phoneNumber"=null,"termsVersion"=null,"privacyVersion"=null,"legalAcceptedAt"=null WHERE id=$1',[actor.user.id]);
 assert.equal((await registrationSnapshot(headers)).required,true);
 await assert.rejects(identityAction(headers,{type:'create',requestId:randomUUID(),name:'Blocked QA'}),/cadastro/i);
 await assert.rejects(completeRegistration(new Headers(),registration),/sessão/i);
 await getPools().authPool.query('UPDATE "user" SET "emailVerified"=false WHERE id=$1',[actor.user.id]);
 await assert.rejects(completeRegistration(headers,registration),/confirme seu e-mail/i);
 await getPools().authPool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1',[actor.user.id]);
 await assert.rejects(completeRegistration(headers,{...registration,accepted:false}),/aceite/i);
 await completeRegistration(headers,registration);
 assert.equal((await registrationSnapshot(headers)).required,false);
 await completeRegistration(headers,{...registration,phone:'+14155550123'});
 assert.equal((await getPools().authPool.query('SELECT "phoneNumber" FROM "user" WHERE id=$1',[actor.user.id])).rows[0].phoneNumber,'+5521973231943');
 const update=await requestAuth('update-user',{phoneNumber:'+14155550123',termsVersion:'forged',registrationRequired:true},actor.cookie);
 assert.ok(update.status>=400);
 await identityAction(headers,{type:'create',requestId:randomUUID(),name:'Entry QA workspace'});
});
test('the actual creation hook marks new non-password identities for completion and preserves legacy users',async()=>{
 const context=await getAuth().$context;
 const user=await context.internalAdapter.createUser({name:'Social hook QA',email:uniqueEmail(),emailVerified:true},{method:'social'});
 const stored=(await getPools().authPool.query('SELECT "registrationRequired","legalAcceptedAt" FROM "user" WHERE id=$1',[user.id])).rows[0];
 assert.equal(stored.registrationRequired,true);assert.equal(stored.legalAcceptedAt,null);
 const id=randomUUID();await getPools().authPool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[id,'Legacy QA',uniqueEmail()]);
 assert.equal((await getPools().authPool.query('SELECT "registrationRequired" FROM "user" WHERE id=$1',[id])).rows[0].registrationRequired,false);
});
test('missing registration metadata cannot distinguish an existing email from a new one',async()=>{
 await resetRateLimits();const existing=await verifiedUser();
 const statuses=[];
 for(const email of [existing.email,uniqueEmail()])statuses.push((await requestAuth('sign-up/email',{name:'Privacy QA',email,password:'Entry-private-password-123!'})).status);
 assert.deepEqual(statuses,[400,400]);
});
test('signup validates normalized JSON content types and uniformly rejects legacy form submissions',async()=>{
 await resetRateLimits();const existing=await verifiedUser();
 for(const type of ['application/x-www-form-urlencoded','Application/JSON']){
  const statuses=[];
  for(const email of [existing.email,uniqueEmail()]){
   const body={name:'Transport QA',email,password:'Entry-private-password-123!'};
   statuses.push((await handleAuthRequest(new Request(base+'/api/auth/sign-up/email',{method:'POST',headers:{origin:base,'content-type':type},body:type.includes('form')?new URLSearchParams(body).toString():JSON.stringify(body)}))).status);
  }
  assert.deepEqual(statuses,type.includes('form')?[415,415]:[400,400]);
 }
});
test('valid signup metadata does not distinguish new accounts from synthetic duplicate responses',async()=>{
 await resetRateLimits();const existing=await verifiedUser();const flags=[];
 for(const email of [existing.email,uniqueEmail()]){
  const response=await requestAuth('sign-up/email',{name:'Shape QA',email,password:'Entry-private-password-123!',registration});assert.equal(response.status,200);
  const data=await response.json();flags.push(data.user.registrationRequired);
  for(const field of ['phoneNumber','termsVersion','privacyVersion','legalAcceptedAt'])assert.equal(Object.hasOwn(data.user,field),false);
 }
 assert.deepEqual(flags,[false,false]);
});
