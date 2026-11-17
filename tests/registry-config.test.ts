import test from 'node:test';import assert from 'node:assert/strict';
import {prospectingConfig,requirements,estimateUsage,usageUnits} from '../src/server/prospecting/config.ts';
// 17/11/2026: one-CNPJ lookups use CNPJá/OpenCNPJ — no Apify CNPJ profile, no Apify run.
function env(web:boolean){
 Object.assign(process.env,{PROSPECTING_ENABLED:'true',APIFY_TOKEN:'fixture',APIFY_MAX_CHARGE_USD:'1',APIFY_WEB_ACTOR:web?'apify/google-search-scraper':'',APIFY_WEB_BUILD:web?'fixture':'',APIFY_CNPJ_ACTOR:'',APIFY_CNPJ_BUILD:''});
 delete process.env.APIFY_LINKEDIN_ACTOR;
}
const ids=['a','b'],q=(extra:object)=>({kind:'qualification',listId:'l',leadIds:ids,modules:[],summaryPolicy:'all',escalation:'off',...extra}) as any;
test('registry module is not blocked without the Apify CNPJ profile',()=>{
 env(true);assert.ok(!requirements(prospectingConfig(),q({modules:['registry']}),'w',null,undefined,false).includes('Configure a consulta cadastral.'));
});
test('enrichment needs only the WEB profile',()=>{
 env(true);const input=q({modules:['decisors'],enrichment:{maxCredits:2,destinationName:'x'}});
 assert.deepEqual(requirements(prospectingConfig(),input,'w',null,undefined,false).filter(b=>/Apify/.test(b)),[]);
 env(false);assert.ok(requirements(prospectingConfig(),input,'w',null,undefined,false).includes('Configure o perfil WEB da Apify antes de enriquecer.'));
});
test('estimates drop the registry Apify run',()=>{
 env(true);
 assert.equal(usageUnits(estimateUsage(q({modules:['registry']}),null)).apifyRuns,2);
 assert.equal(usageUnits(estimateUsage(q({modules:['decisors'],enrichment:{maxCredits:2,destinationName:'x'}}),null)).apifyRuns,4);
 assert.equal(usageUnits(estimateUsage(q({modules:['decisors'],enrichment:{maxCredits:2,destinationName:'x'},companyPeople:{}}),null)).apifyRuns,4);
 assert.equal(usageUnits(estimateUsage(q({companyResearch:{sourceKinds:['registry']}}),null)).apifyRuns,undefined);
 env(false);
 assert.equal(usageUnits(estimateUsage(q({modules:['registry']}),null)).apifyRuns,undefined);
});
