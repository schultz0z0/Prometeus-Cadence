import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedinAccountReady,unipileSourcesState,linkedinSyncDelayMs,LINKEDIN_TERMS,confirmConnectSchema,notifySchema} from '../src/domain/linkedin-connection.ts';
import {unipileSettings,unipileAccount,hostedLink,UnipileMissing,UnipileRetry} from '../src/server/linkedin/unipile.ts';

test('07A.1 readiness needs a connected, unrevoked account on the current attestation',()=>{
 assert.equal(linkedinAccountReady({connected:true,revoked:false,capabilitiesVersionMatches:false}),false,'a re-attested adapter voids readiness until the next check');
 assert.equal(linkedinAccountReady({connected:true,revoked:true,capabilitiesVersionMatches:true}),false);
 assert.equal(linkedinAccountReady({connected:false,revoked:false,capabilitiesVersionMatches:true}),false);
 assert.equal(linkedinAccountReady({connected:true,revoked:false,capabilitiesVersionMatches:true}),true);
});

test('07A.1 Unipile source statuses map to one account state, worst first',()=>{
 assert.equal(unipileSourcesState(['OK','OK']),'ready');
 assert.equal(unipileSourcesState(['OK','CREDENTIALS']),'restricted');
 assert.equal(unipileSourcesState(['PERMISSIONS']),'restricted');
 assert.equal(unipileSourcesState(['CONNECTING','OK']),'connecting');
 assert.equal(unipileSourcesState(['STOPPED']),'error');
 assert.equal(unipileSourcesState(['ERROR','CREDENTIALS']),'restricted','a reconnect fixes credentials; say that first');
 assert.equal(unipileSourcesState([]),'error','no source proves nothing');
 assert.equal(unipileSourcesState(['SOMETHING_NEW']),'error');
});

test('07A.1 failed checks back off and never retry faster than five minutes',()=>{
 assert.equal(linkedinSyncDelayMs(0),6*3600e3);
 assert.equal(linkedinSyncDelayMs(1),5*60e3);
 assert.equal(linkedinSyncDelayMs(2),10*60e3);
 assert.equal(linkedinSyncDelayMs(30),6*3600e3);
});

test('07A.1 connecting needs the current terms accepted explicitly; the notify body is narrow',()=>{
 assert.ok(LINKEDIN_TERMS.version&&LINKEDIN_TERMS.items.length>=3);
 assert.equal(confirmConnectSchema.safeParse({termsVersion:LINKEDIN_TERMS.version,acceptTerms:false,expectedRevision:0}).success,false);
 assert.equal(confirmConnectSchema.safeParse({termsVersion:LINKEDIN_TERMS.version,acceptTerms:true,expectedRevision:0,extra:1}).success,false);
 assert.equal(confirmConnectSchema.safeParse({termsVersion:LINKEDIN_TERMS.version,acceptTerms:true,expectedRevision:0}).success,true);
 assert.equal(notifySchema.safeParse({status:'CREATION_SUCCESS',account_id:'e54m8LR22bA7G5qsAc8w',name:'x'}).success,true);
 assert.equal(notifySchema.safeParse({status:'OK',account_id:'e54m8LR22bA7G5qsAc8w',name:'x'}).success,false);
 assert.equal(notifySchema.safeParse({status:'CREATION_SUCCESS',account_id:'../accounts',name:'x'}).success,false);
});

test('07A.1 Unipile settings are required and the DSN is a host:port',()=>{
 assert.throws(()=>unipileSettings({}),{status:503,code:'LINKEDIN_NOT_CONFIGURED'});
 assert.throws(()=>unipileSettings({UNIPILE_DSN:'https://api1.unipile.com:13111/x',UNIPILE_API_KEY:'k'}),{status:503});
 assert.deepEqual(unipileSettings({UNIPILE_DSN:'api1.unipile.com:13111',UNIPILE_API_KEY:'k'}),{base:'https://api1.unipile.com:13111',key:'k'});
});

test('07A.1 Unipile client: key in the header, account read, 404 is missing, 429 retries, link must be https',async()=>{
 const env={UNIPILE_DSN:'api1.unipile.com:13111',UNIPILE_API_KEY:'key-qa'},seen:string[]=[];
 const reply=(status:number,body:unknown,headers:Record<string,string>={})=>(async(input:RequestInfo|URL,init?:RequestInit)=>{seen.push(String(input));assert.equal((init?.headers as Record<string,string>)['x-api-key'],'key-qa');assert.equal(init?.redirect,'error');return Response.json(body,{status,headers});}) as typeof fetch;
 const account={object:'Account',type:'LINKEDIN',id:'acc_1234567',name:'[RE] Pessoa',connection_params:{im:{id:'ACoAA123',publicIdentifier:'re-pessoa'}},sources:[{id:'s',status:'OK'}]};
 assert.deepEqual(await unipileAccount('acc_1234567',{fetch:reply(200,account)},env),{name:'[RE] Pessoa',memberId:'ACoAA123',state:'ready'});
 assert.equal(seen.at(-1),'https://api1.unipile.com:13111/api/v1/accounts/acc_1234567');
 await assert.rejects(unipileAccount('acc_1234567',{fetch:reply(200,{...account,type:'WHATSAPP'})},env),UnipileMissing);
 await assert.rejects(unipileAccount('acc_1234567',{fetch:reply(404,{})},env),UnipileMissing);
 await assert.rejects(unipileAccount('acc_1234567',{fetch:reply(429,{},{'retry-after':'30'})},env),(e:unknown)=>e instanceof UnipileRetry&&e.retryAfterMs===30000);
 await assert.rejects(unipileAccount('acc_1234567',{fetch:(async()=>{throw new TypeError('offline');}) as typeof fetch},env),UnipileRetry);
 const input={type:'create' as const,name:'n',notifyUrl:'https://app.example.com/n',successUrl:'https://app.example.com/s',failureUrl:'https://app.example.com/f',expiresOn:new Date(Date.now()+6e5).toISOString()};
 assert.equal(await hostedLink(input,{fetch:reply(201,{object:'HostedAuthURL',url:'https://account.unipile.com/abc'})},env),'https://account.unipile.com/abc');
 await assert.rejects(hostedLink(input,{fetch:reply(201,{object:'HostedAuthURL',url:'javascript:alert(1)'})},env),UnipileRetry);
});
