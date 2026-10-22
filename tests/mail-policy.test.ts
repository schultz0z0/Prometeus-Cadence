import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMailAddress,evaluateMailPolicy,validateMailContent} from '../src/domain/mail-policy.ts';
import {isPublicationV2} from '../src/domain/cadence-runtime.ts';
const now='2026-10-21T12:00:00.000Z';
const base={purpose:'campaign' as const,authorized:true,suppressed:false,hasInbound:false,sendReady:true,syncState:'ready' as const,lastSyncedAt:now,now};
test('mail addresses preserve distinct local parts and aliases while normalizing domains',()=>{
 assert.equal(normalizeMailAddress('Sales+one@EXAMPLE.com'),'Sales+one@example.com');
 assert.notEqual(normalizeMailAddress('a.b@example.com'),normalizeMailAddress('ab@example.com'));
 assert.notEqual(normalizeMailAddress('a+one@example.com'),normalizeMailAddress('a@example.com'));
 assert.notEqual(normalizeMailAddress('Sales@example.com'),normalizeMailAddress('sales@example.com'));
 assert.equal(normalizeMailAddress('sales@exämple.org'),'sales@xn--exmple-cua.org');
});
test('mail address parser rejects injection recipient lists and invalid boundaries',()=>{
 for(const value of ['','a@example.com\r\nBcc: x@example.com','a@example.com,b@example.com','User <a@example.com>','a b@example.com','a@localhost','a@@example.com','é@example.com','a..b@example.com','a@example.com/path'])assert.throws(()=>normalizeMailAddress(value),value);
});
test('public lead address does not authorize a campaign and suppression blocks authorized email',()=>{
 assert.equal(evaluateMailPolicy({...base,authorized:false}).allowed,false);
 assert.ok(evaluateMailPolicy({...base,authorized:false}).blockers.includes('EMAIL_AUTHORIZATION_REQUIRED'));
 assert.equal(evaluateMailPolicy({...base,suppressed:true}).allowed,false);
 assert.equal(evaluateMailPolicy(base).allowed,true);
});
test('manual email service reply requires an existing incoming conversation',()=>{
 assert.equal(evaluateMailPolicy({...base,purpose:'service',authorized:false}).allowed,false);
 assert.equal(evaluateMailPolicy({...base,purpose:'service',authorized:false,hasInbound:true}).allowed,true);
 assert.equal(evaluateMailPolicy({...base,purpose:'test',authorized:false,hasInbound:true}).allowed,false);
});
test('campaign sync health enforces exact five minute boundary and fails closed for future clocks',()=>{
 assert.equal(evaluateMailPolicy({...base,lastSyncedAt:'2026-10-21T11:55:00.000Z'}).allowed,true);
 for(const input of [{lastSyncedAt:'2026-10-21T11:54:59.999Z'},{lastSyncedAt:'2026-10-21T12:00:00.001Z'},{lastSyncedAt:null},{syncState:'recovering' as const},{syncState:'error' as const},{now:'bad'},{sendReady:false}])assert.equal(evaluateMailPolicy({...base,...input}).allowed,false,JSON.stringify(input));
});
test('mail content rejects header injection and bounded UTF8 bytes without WhatsApp text limits',()=>{
 assert.deepEqual(validateMailContent({kind:'email',subject:'Olá',text:'x'.repeat(5000),signature:'Equipe'}),[]);
 for(const content of [{subject:'Hi\r\nBcc: nope'},{subject:''},{subject:'a'.repeat(201)},{text:'á'.repeat(32769)},{signature:'x'.repeat(4097)}])assert.ok(validateMailContent({kind:'email',subject:'Olá',text:'Corpo',signature:'Equipe',...content}).length);
});
test('publication discriminator keeps legacy snapshots separate from v2',()=>{
 assert.equal(isPublicationV2({cadence:{},sender:{},recipients:[]}),false);
 assert.equal(isPublicationV2(null),false);
 assert.equal(isPublicationV2({version:2}),true);
});
