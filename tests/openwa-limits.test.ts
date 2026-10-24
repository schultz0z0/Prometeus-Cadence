import test from 'node:test';import assert from 'node:assert/strict';
import {openwaLimitPolicy} from '../src/domain/openwa-limits.ts';import {evaluateSendPolicy} from '../src/domain/whatsapp-policy.ts';
const base={provider:'meta' as const,now:'2026-10-23T12:00:00Z',lastInboundAt:null,purpose:'service' as const,hasOptIn:true,suppressed:false,senderReady:true,content:{kind:'text' as const,text:'Authorized message'},template:null};
test('OpenWA text requires authorization outside service window without inheriting Meta template restrictions',()=>{
 assert.equal(evaluateSendPolicy(base).allowed,false);
 assert.equal(evaluateSendPolicy({...base,provider:'openwa'}).allowed,true);
 assert.equal(evaluateSendPolicy({...base,provider:'openwa',hasOptIn:false}).allowed,false);
 assert.equal(evaluateSendPolicy({...base,provider:'openwa',hasOptIn:false,lastInboundAt:'2026-10-23T11:00:00Z'}).allowed,true);
 assert.equal(evaluateSendPolicy({...base,provider:'openwa',content:{kind:'template',templateId:'t',templateRevision:1,variables:{}}}).allowed,false);
 for(const provider of ['twilio','unknown'])assert.equal(evaluateSendPolicy({...base,provider:provider as 'twilio',lastInboundAt:'2026-10-23T11:00:00Z'}).allowed,false);
 assert.equal(evaluateSendPolicy({...base,provider:'openwa',now:'invalid'}).allowed,false);
});
test('sender daily and new-conversation limits stay integral, ordered and within platform capacity',()=>{
 assert.deepEqual(openwaLimitPolicy({dailyLimit:20,newConversationLimit:5,platformDailyCap:20,platformNewConversationCap:5}),{allowed:true,blockers:[]});
 for(const change of [{dailyLimit:21},{newConversationLimit:6},{dailyLimit:2,newConversationLimit:3},{dailyLimit:1.5},{newConversationLimit:0},{platformDailyCap:NaN},{platformNewConversationCap:21}])assert.equal(openwaLimitPolicy({dailyLimit:20,newConversationLimit:5,platformDailyCap:20,platformNewConversationCap:5,...change}).allowed,false);
});
