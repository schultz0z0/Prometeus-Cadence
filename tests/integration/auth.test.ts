import test,{after} from 'node:test';import assert from 'node:assert/strict';
import {getAuth,handleAuthRequest} from '../../src/server/auth/auth.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {base,password,requestAuth,mailLink,uniqueEmail,verifiedUser,resetRateLimits} from './helpers.ts';
after(async()=>{await getPools().close();});
test('email verification is required and session cookie is HttpOnly',async()=>{
 await resetRateLimits();const email=uniqueEmail();
 const signup=await requestAuth('sign-up/email',{name:'Identity Test',email,password,callbackURL:base+'/onboarding/workspace'});assert.equal(signup.status,200);
 const blocked=await requestAuth('sign-in/email',{email,password});assert.equal(blocked.status,403);
 const link=await mailLink(email,'verify-email');const verify=await handleAuthRequest(new Request(link));assert.ok(verify.status<400);assert.match(verify.headers.get('set-cookie')??'',/httponly/i);
 const cookie=verify.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');const session=await getAuth().api.getSession({headers:new Headers({cookie})});assert.equal(session?.user.email,email);
 assert.ok(!JSON.stringify(session).includes('password'));
 const out=await requestAuth('sign-out',{},cookie);assert.equal(out.status,200);assert.equal(await getAuth().api.getSession({headers:new Headers({cookie})}),null);
});
test('password reset is single-use and revokes old sessions',async()=>{
 await resetRateLimits();const user=await verifiedUser();
 const forgot=await requestAuth('request-password-reset',{email:user.email,redirectTo:base+'/reset-password'});assert.equal(forgot.status,200);
 const link=await mailLink(user.email,'reset-password');const url=new URL(link);let token=url.searchParams.get('token');
 if(!token){const redirect=await handleAuthRequest(new Request(link));token=new URL(redirect.headers.get('location')!,base).searchParams.get('token');}
 assert.ok(token);const body={token,newPassword:'Changed-local-password-123!'};
 assert.equal((await requestAuth('reset-password',body)).status,200);assert.ok((await requestAuth('reset-password',body)).status>=400);
 assert.equal(await getAuth().api.getSession({headers:new Headers({cookie:user.cookie})}),null);
 assert.ok((await requestAuth('sign-in/email',{email:user.email,password})).status>=400);
 assert.equal((await requestAuth('sign-in/email',{email:user.email,password:body.newPassword})).status,200);
});
test('untrusted origin/callback and repeated invalid logins are rejected',async()=>{
 await resetRateLimits();const email=uniqueEmail();
 const foreign=await handleAuthRequest(new Request(base+'/api/auth/sign-in/email',{method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},body:JSON.stringify({email,password})}));assert.equal(foreign.status,403);
 const callback=await requestAuth('sign-up/email',{name:'Rejected',email,password,callbackURL:'https://attacker.example'});assert.ok(callback.status>=400);
 await resetRateLimits();let response:Response|undefined;
 for(let i=0;i<6;i++)response=await requestAuth('sign-in/email',{email,password});assert.equal(response!.status,429);
 await getPools().authPool.query('UPDATE "rateLimit" SET "lastRequest"=0');
 assert.notEqual((await requestAuth('sign-in/email',{email,password})).status,429);
});
test('duplicate normalized email, expired sessions and expired reset links are rejected',async()=>{
 await resetRateLimits();const user=await verifiedUser();
 await requestAuth('sign-up/email',{name:'Duplicate',email:user.email.toUpperCase(),password});
 // Verification-enabled sign-up deliberately conceals account existence.
 const count=await getPools().authPool.query('SELECT count(*)::int AS n FROM "user" WHERE lower(email)=lower($1)',[user.email]);assert.equal(count.rows[0].n,1);
 await getPools().authPool.query('UPDATE session SET "expiresAt"=now()-interval \'1 minute\' WHERE "userId"=$1',[user.user.id]);
 assert.equal(await getAuth().api.getSession({headers:new Headers({cookie:user.cookie})}),null);
 await requestAuth('request-password-reset',{email:user.email,redirectTo:base+'/reset-password'});
 const link=await mailLink(user.email,'reset-password');const token=new URL(link).pathname.split('/').at(-1)!;
 await getPools().authPool.query('UPDATE verification SET "expiresAt"=now()-interval \'1 minute\' WHERE identifier LIKE \'reset-password:%\'');
 assert.ok((await requestAuth('reset-password',{token,newPassword:password+'new'})).status>=400);
});
test('public session and login responses do not expose bearer tokens',async()=>{
 await resetRateLimits();const user=await verifiedUser();
 const response=await requestAuth('get-session',undefined,user.cookie);const session=await response.json();
 assert.ok(!Object.hasOwn(session.session,'token'));
 const login=await requestAuth('sign-in/email',{email:user.email,password});const body=await login.json();assert.ok(!Object.hasOwn(body,'token'));
});
