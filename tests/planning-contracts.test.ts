import test from 'node:test';
import assert from 'node:assert/strict';
import {planningInputSchema,validatePlanningResult,validateFieldSupport} from '../src/server/planning/contracts.ts';
import {jobInputSchema} from '../src/server/prospecting/schemas.ts';
import {estimateUsage,usageUnits} from '../src/server/prospecting/config.ts';
import type {AiRoute} from '../src/domain/ai-routing.ts';
import {audienceResult,cadenceResult,planningSources} from './planning-fixtures.ts';

test('planning rejects invented market counts, duplicate options and unsupported source filters',()=>{
  assert.equal(validatePlanningResult('audience_plan',audienceResult(),[]).success,true);
  for(const mutate of [
    (v:any)=>v.options[0].marketSize=116293,
    (v:any)=>v.options.pop(),
    (v:any)=>v.options[1].id='option_1',
    (v:any)=>v.options[0].source='LINKEDIN',
    (v:any)=>v.options[0].filters.actor='evil/actor',
    (v:any)=>v.options[0].filters.url='https://api.example.com',
  ]){const v=audienceResult();mutate(v);assert.equal(validatePlanningResult('audience_plan',v,[]).success,false);}
});
test('context facts require literal support from owned evidence and empty unknown fields need none',()=>{
  const sources=planningSources();
  assert.equal(validateFieldSupport({value:'Clínicas',evidenceIds:['page_1'],quote:'Atendemos clínicas.'},sources),true);
  assert.equal(validateFieldSupport({value:'R$99',evidenceIds:['foreign'],quote:'R$99'},sources),false);
  assert.equal(validateFieldSupport({value:'R$99',evidenceIds:['page_1'],quote:'R$99'},sources),false);
  assert.equal(validateFieldSupport({value:'Algo',evidenceIds:[],quote:''},sources),false);
  assert.equal(validateFieldSupport({value:'',evidenceIds:[],quote:''},sources),true);
  assert.equal(validatePlanningResult('context_read',{fields:{offer:{value:'R$99',evidenceIds:['page_1'],quote:'R$99'}}},sources).success,false);
});
test('cadence proposals require three distinct sequences, supported variables and email subjects',()=>{
  assert.equal(validatePlanningResult('cadence_options',cadenceResult(),[]).success,true);
  for(const mutate of [
    (v:any)=>v.options[0].steps[0].body='{{senha}}',
    (v:any)=>v.options[0].steps[0].delayDays=-1,
    (v:any)=>v.options[0].steps[0].channel='LINKEDIN',
    (v:any)=>{v.options[0].steps[0].channel='EMAIL';delete v.options[0].steps[0].subject;},
    (v:any)=>v.options[0].steps[0].body='x'.repeat(2001),
    (v:any)=>v.options[0].steps.pop(),
    (v:any)=>v.options[1].steps=structuredClone(v.options[0].steps),
  ]){const v=cadenceResult();mutate(v);assert.equal(validatePlanningResult('cadence_options',v,[]).success,false);}
});
test('planning input is bounded and cannot enter the legacy public prospecting endpoint',()=>{
  const input={kind:'planning',task:'audience_plan',description:'Clínicas em São Paulo',channel:'whatsapp',timezone:'America/Sao_Paulo'};
  assert.equal(planningInputSchema.safeParse(input).success,true);
  assert.equal(jobInputSchema.safeParse(input).success,false);
  for(const extra of [{description:'a'.repeat(4001)},{timezone:'inventado'},{provider:'openai'},{checkpoint:{}},{model:'anything'}])assert.equal(planningInputSchema.safeParse({...input,...extra}).success,false);
});

test('cadence rhythm is validated before spending an inference',()=>{
  const input={kind:'planning',task:'cadence_options',listId:'qa-list',objective:'Primeiro contato',channels:['WHATSAPP'],tone:'Pessoal',rhythm:'Padrão',highlight:'',avoid:'',decisionMaker:''};
  for(const rhythm of ['Curta','Padrão','Longa'])assert.equal(planningInputSchema.safeParse({...input,rhythm}).success,true);
  assert.equal(planningInputSchema.safeParse({...input,rhythm:'dias 0, 3 e 7'}).success,false);
});
test('planning budgets reserve one content call and rank only audience or cadence in hybrid mode',()=>{
  const conventional={provider:'openai',model:'fixture',configFingerprint:'fixture',contractVersion:'conventional-v1'} as const;
  const route:AiRoute={mode:'auto',policyRevision:1,effectiveMode:'hybrid',conventional,decisionProvider:'jev'};
  const input=planningInputSchema.parse({kind:'planning',task:'audience_plan',description:'Clínicas',channel:'email',timezone:'UTC'});
  assert.deepEqual(usageUnits(estimateUsage(input,route)),{openaiCalls:1,jevCalls:1});
  assert.deepEqual(usageUnits(estimateUsage(input,{...route,decisionProvider:'openai'})),{openaiCalls:1});
  const context=planningInputSchema.parse({kind:'planning',task:'context_read',domain:'example.com',target:{kind:'company'}});
  assert.deepEqual(usageUnits(estimateUsage(context,route)),{openaiCalls:1});
});
