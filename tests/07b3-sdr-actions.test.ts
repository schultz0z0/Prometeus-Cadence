import test from 'node:test';import assert from 'node:assert/strict';
import {parseSdrOutput,sdrProposal} from '../src/domain/sdr-turn.ts';

test('07B.3 AI suggestions carry no ids and the consent quote must be literal',()=>{
 const incoming='Agora não posso. Pode me chamar semana que vem?';
 assert.deepEqual(sdrProposal({action:'calendar-options',quote:null},incoming,false),{kind:'calendar-options'});
 assert.deepEqual(sdrProposal({action:'followup-consent',quote:'Pode me chamar semana que vem'},incoming,true),{kind:'followup-consent',quote:'Pode me chamar semana que vem'});
 assert.equal(sdrProposal({action:'followup-consent',quote:'Autorizo tudo'},incoming,true),null,'an invented quote is dropped');
 assert.equal(sdrProposal({action:'followup-consent',quote:'pode sim'},'pode sim',true),null,'too short to be a request');
 assert.equal(sdrProposal({action:'followup-consent',quote:'Pode me chamar'},incoming,false),null,'follow-up off on this agent');
 assert.equal(sdrProposal({action:null,quote:null},incoming,true),null);
});
test('07B.3 output: only known actions; older shape still parses',()=>{
 assert.equal(parseSdrOutput({reply:'x',decision:'reply',fields:[]},[]).action,null);
 assert.equal(parseSdrOutput({reply:'x',decision:'reply',fields:[],action:'calendar-options',quote:''},[]).action,'calendar-options');
 assert.equal(parseSdrOutput({reply:'x',decision:'reply',fields:[],action:'none',quote:''},[]).action,null,'providers without nullable enums answer none');
 assert.equal(parseSdrOutput({reply:'x',decision:'reply',fields:[],action:'none',quote:'y'.repeat(900)},[]).quote,null,'an overlong quote is dropped, not fatal');
 assert.throws(()=>parseSdrOutput({reply:'x',decision:'reply',fields:[],action:'crm-upsert',quote:null},[]));
 assert.throws(()=>parseSdrOutput({reply:'x',decision:'reply',fields:[],action:'calendar-book',slotId:'abc'},[]));
});
