import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSendPolicy} from '../src/domain/whatsapp-policy.ts';
import type {SendPolicyInput,TemplateView} from '../src/domain/whatsapp.ts';
const template:TemplateView={id:'t1',connectionId:'c1',provider:'meta',remoteId:'remote1',name:'hello',language:'pt_BR',status:'approved',revision:1,hash:'hash1',parameters:[{component:'body',key:'body.1',type:'text'}],components:[{type:'body',text:'Olá {{1}}, podemos conversar?'}]};
const base:SendPolicyInput={now:'2026-10-21T12:00:00.000Z',lastInboundAt:'2026-10-21T11:00:00.000Z',purpose:'service',hasOptIn:false,suppressed:false,senderReady:true,content:{kind:'text',text:'Olá'},template:null};
test('exact_24h_is_closed and outbound receipt does not substitute for inbound',()=>{
 assert.equal(evaluateSendPolicy(base).allowed,true);
 assert.equal(evaluateSendPolicy({...base,lastInboundAt:'2026-10-20T12:00:00.000Z'}).allowed,false);
 assert.equal(evaluateSendPolicy({...base,lastInboundAt:null}).allowed,false);
});
test('future_inbound_does_not_authorize and malformed clocks fail closed',()=>{
 for(const lastInboundAt of ['2026-10-21T12:00:01Z','bad-date'])assert.equal(evaluateSendPolicy({...base,lastInboundAt}).allowed,false);
 assert.equal(evaluateSendPolicy({...base,now:'not-a-date'}).allowed,false);
});
test('campaign_requires_evidence even within service window; suppression and unavailable sender block all',()=>{
 assert.equal(evaluateSendPolicy({...base,purpose:'campaign'}).allowed,false);
 assert.equal(evaluateSendPolicy({...base,purpose:'campaign',hasOptIn:true}).allowed,true);
 assert.equal(evaluateSendPolicy({...base,purpose:'test'}).allowed,false);
 assert.equal(evaluateSendPolicy({...base,hasOptIn:true,suppressed:true}).allowed,false);
 assert.equal(evaluateSendPolicy({...base,senderReady:false}).allowed,false);
 assert.equal(evaluateSendPolicy({...base,content:{kind:'text',text:'  '}}).allowed,false);
});
test('template_revision_and_components_match; only approved textual parameters may dispatch',()=>{
 const request:SendPolicyInput={...base,lastInboundAt:null,hasOptIn:true,template,content:{kind:'template',templateId:'t1',templateRevision:1,variables:{'body.1':'Maria'}}};
 assert.equal(evaluateSendPolicy(request).allowed,true);
 for(const change of [{template:null},{hasOptIn:false},{template:{...template,status:'rejected' as const}},{template:{...template,revision:2}},{template:{...template,id:'other'}},{template:{...template,parameters:[{component:'header' as const,key:'header.1',type:'media' as const}]}}])assert.equal(evaluateSendPolicy({...request,...change}).allowed,false);
 const invalidVariables:Record<string,string>[]=[{},{'body.1':' '},{'body.1':'Maria',unknown:'extra'}];
 for(const variables of invalidVariables)assert.equal(evaluateSendPolicy({...request,content:{kind:'template',templateId:'t1',templateRevision:1,variables}}).allowed,false);
 assert.equal(evaluateSendPolicy({...request,content:{kind:'template',templateId:'t1',templateRevision:1,variables:{'body.1':'{{nome}}'}}}).allowed,false);
});
