import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedinMessageMode,linkedinActionAllowed,linkedinInventory,linkedinFeasibility,attestationSchema,NO_LINKEDIN,LINKEDIN_CAPABILITY_KEYS} from '../src/domain/linkedin-capabilities.ts';

const future=()=>new Date(Date.now()+30*864e5).toISOString();
const caps=(over:Partial<typeof NO_LINKEDIN>={})=>({...NO_LINKEDIN,version:'v1',verifiedAt:new Date().toISOString(),...over});

test('07A.0 official messages need a member action: never automatic, never scheduled',()=>{
 assert.equal(linkedinMessageMode({approved:true,humanActionRequired:true,canMessage:true}),'assisted');
 assert.equal(linkedinMessageMode({approved:true,humanActionRequired:false,canMessage:true}),'automatic');
 assert.equal(linkedinMessageMode({approved:false,humanActionRequired:false,canMessage:true}),'unavailable');
 assert.equal(linkedinMessageMode({approved:true,humanActionRequired:false,canMessage:false}),'unavailable');
 const assisted=caps({sendMessage:'assisted'});
 assert.equal(linkedinActionAllowed(assisted,'sendMessage'),true);
 assert.equal(linkedinActionAllowed(assisted,'scheduledMessage'),false);
 assert.equal(linkedinActionAllowed(caps({sendMessage:'automatic'}),'scheduledMessage'),true);
});

test('07A.0 OAuth login alone grants nothing else; nothing is allowed by default',()=>{
 const login=caps({connect:true});
 for(const k of LINKEDIN_CAPABILITY_KEYS)assert.equal(linkedinActionAllowed(login,k),k==='connect',k);
 for(const k of LINKEDIN_CAPABILITY_KEYS)assert.equal(linkedinActionAllowed(NO_LINKEDIN,k),false,k);
 assert.equal(linkedinActionAllowed(caps({profileActions:['visit']}),'profileVisit'),true);
 assert.equal(linkedinActionAllowed(caps({profileActions:['visit']}),'comment'),false);
});

test('07A.0 every observed reference action maps to a capability with evidence; a missing one is blocked, not a success',()=>{
 assert.ok(linkedinInventory.length>=15);
 for(const a of linkedinInventory){
  assert.ok(LINKEDIN_CAPABILITY_KEYS.includes(a.capability as never)||a.capability==='local',a.id);
  assert.match(a.evidence,/^EV-\d{3}$/,a.id);
 }
 assert.equal(new Set(linkedinInventory.map(a=>a.id)).size,linkedinInventory.length);
 const none=linkedinFeasibility(NO_LINKEDIN,'Nenhum adaptador habilitado.');
 for(const row of none.filter(r=>r.capability!=='local')){assert.equal(row.allowed,false,row.id);assert.equal(row.reason,'Nenhum adaptador habilitado.');}
 const invite=linkedinFeasibility(caps({invite:true}),'').find(r=>r.id==='invite-note')!;
 assert.equal(invite.allowed,true);assert.equal(invite.reason,'');
});

test('07A.0 attestation: evidence for every enabled capability, official cannot be automatic, bounded validity',()=>{
 const ok={adapterId:'acme-connector',kind:'account-connector',agreementRef:'Contrato QA 2026-11',expiresAt:future(),capabilities:caps({connect:true,invite:true}),evidenceRefs:{connect:['docs/x.md'],invite:['docs/y.md']}};
 assert.equal(attestationSchema.safeParse(ok).success,true);
 assert.equal(attestationSchema.safeParse({...ok,evidenceRefs:{connect:['docs/x.md']}}).success,false,'invite without evidence');
 assert.equal(attestationSchema.safeParse({...ok,kind:'official',capabilities:caps({sendMessage:'automatic'}),evidenceRefs:{sendMessage:['d']}}).success,false,'official automatic');
 assert.equal(attestationSchema.safeParse({...ok,kind:'official',capabilities:caps({sendMessage:'assisted'}),evidenceRefs:{sendMessage:['d']}}).success,true);
 assert.equal(attestationSchema.safeParse({...ok,expiresAt:new Date(Date.now()-1000).toISOString()}).success,false,'expired');
 assert.equal(attestationSchema.safeParse({...ok,expiresAt:new Date(Date.now()+401*864e5).toISOString()}).success,false,'too long');
 assert.equal(attestationSchema.safeParse({...ok,adapterId:'Bad Id'}).success,false);
 assert.equal(attestationSchema.safeParse({...ok,capabilities:{...ok.capabilities,profileActions:['dance']}}).success,false);
});

test('07A.0 review: a malformed stored profile fails closed instead of allowing or throwing',()=>{
 const bad={...NO_LINKEDIN,sendMessage:undefined,profileActions:undefined} as never;
 for(const k of LINKEDIN_CAPABILITY_KEYS)assert.equal(linkedinActionAllowed(bad,k),false,k);
});
