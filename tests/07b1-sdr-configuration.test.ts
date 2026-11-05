import test from 'node:test';import assert from 'node:assert/strict';
import {sdrActivationAllowed,sdrBlockers,sdrDraftSchema,defaultSdrDraft,type SdrFacts} from '../src/domain/sdr-policy.ts';

const draft=()=>({...defaultSdrDraft(),name:'[RE] Agente',instructions:'Somos a QA. Atenda com tom direto.',channelIds:['c1'],handoff:{memberId:'u1',rules:['Pediu preço fechado']}});
const facts=(o:Partial<SdrFacts>={}):SdrFacts=>({pro:true,contextApproved:true,channels:[{id:'c1',ready:true,provider:'meta',takenBy:null}],handoffIsMember:true,knowledge:[],...o});

test('07B.1 an agent without a human handoff never activates',()=>{
 assert.equal(sdrActivationAllowed({contextApproved:true,channelReady:true,hasHandoff:false,reviewed:true}),false);
 assert.equal(sdrActivationAllowed({contextApproved:true,channelReady:true,hasHandoff:true,reviewed:false}),false);
 assert.equal(sdrActivationAllowed({contextApproved:true,channelReady:true,hasHandoff:true,reviewed:true}),true);
});

test('07B.1 defaults: approval of every reply, 20 replies a day, no follow-up, WhatsApp hours',()=>{
 const d=defaultSdrDraft();
 assert.equal(d.approvalMode,'all');assert.equal(d.maxRepliesPerDay,20);assert.equal(d.followupEnabled,false);
 assert.deepEqual(d.hours,{timezone:'America/Sao_Paulo',weekdays:[1,2,3,4,5],start:'09:00',end:'18:00',allDay:false});
 assert.ok(sdrDraftSchema.safeParse(draft()).success);
});

test('07B.1 the draft is strict: no model or key, valid hours and limits',()=>{
 assert.equal(sdrDraftSchema.safeParse({...draft(),model:'gpt-x'}).success,false,'model is platform-owned');
 assert.equal(sdrDraftSchema.safeParse({...draft(),apiKey:'sk-1'}).success,false);
 assert.equal(sdrDraftSchema.safeParse({...draft(),hours:{...draft().hours,timezone:'Mars/Base'}}).success,false);
 assert.equal(sdrDraftSchema.safeParse({...draft(),hours:{...draft().hours,start:'18:00',end:'09:00'}}).success,false);
 assert.ok(sdrDraftSchema.safeParse({...draft(),hours:{...draft().hours,start:'18:00',end:'09:00',allDay:true}}).success);
 assert.equal(sdrDraftSchema.safeParse({...draft(),hours:{...draft().hours,weekdays:[]}}).success,false);
 assert.equal(sdrDraftSchema.safeParse({...draft(),maxRepliesPerDay:0}).success,false);
 assert.equal(sdrDraftSchema.safeParse({...draft(),qualification:Array.from({length:11},(_,i)=>({question:'Q'+i,field:'f'+i,required:false}))}).success,false);
});

test('07B.1 blockers name every missing prerequisite',()=>{
 assert.deepEqual(sdrBlockers(draft(),facts()),[]);
 const all=sdrBlockers({...draft(),approvalMode:'bounded-auto',followupEnabled:true,knowledgeIds:['k1']},
  facts({pro:false,contextApproved:false,channels:[{id:'c1',ready:false,provider:'meta',takenBy:null}],handoffIsMember:false,knowledge:[{id:'k1',state:'draft'}]}));
 for(const re of[/Pro/,/contexto/i,/canal/i,/responsável/i,/conhecimento/i,/piloto/i])assert.ok(all.some(b=>re.test(b)),String(re));
 assert.ok(sdrBlockers(draft(),facts({channels:[{id:'c1',ready:true,provider:'meta',takenBy:'Outro agente'}]})).some(b=>/Outro agente/.test(b)));
 assert.ok(sdrBlockers({...draft(),maxRepliesPerDay:21},facts({channels:[{id:'c1',ready:true,provider:'openwa',takenBy:null}]})).some(b=>/20/.test(b)),'OpenWA shares the 20/day ceiling');
 assert.ok(sdrBlockers({...draft(),channelIds:[]},facts()).some(b=>/canal/i.test(b)));
 assert.ok(sdrBlockers({...draft(),channelIds:['gone']},facts()).some(b=>/canal/i.test(b)),'a channel not in this workspace blocks');
});
