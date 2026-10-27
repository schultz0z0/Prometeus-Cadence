import test from 'node:test';import assert from 'node:assert/strict';
import {qualificationSkipReason,assessEmail} from '../src/domain/qualification-policy.ts';
test('qualification selection options use actual fields and processed state without inventing proof',()=>{
 const lead={name:'Exemplo',email:'ana@example.com'};
 assert.equal(qualificationSkipReason(lead,{onlyWithSite:true},false),'NO_SITE');
 assert.equal(qualificationSkipReason(lead,{onlyMissingEmail:true},false),'ALREADY_HAS_EMAIL');
 assert.equal(qualificationSkipReason(lead,{skipProcessed:true},true),'ALREADY_PROCESSED');
 assert.equal(qualificationSkipReason(lead,{},true),null);
 assert.equal(qualificationSkipReason({...lead,site:'https://example.com'},{skipWithoutSite:true},false),null);
});
test('email DNS assessment never claims mailbox or recipient verification',()=>{
 const at='2026-10-26T21:00:00Z';
 assert.deepEqual(assessEmail('ana@example.com',{format:true,dns:true,mailbox:'not_verified'},at),{address:'ana@example.com',format:'valid',domain:'found',mailbox:'unverified',checkedAt:at});
 assert.equal(assessEmail('ana@example.com',{format:true,dns:null,mailbox:'not_verified'},at).domain,'unknown');
 assert.equal(assessEmail('bad',{format:false,dns:null,mailbox:'not_verified'},at).format,'invalid');
});
