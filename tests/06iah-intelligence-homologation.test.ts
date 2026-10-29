import test from 'node:test';import assert from 'node:assert/strict';
import {acceptResearchEvaluation,scoreResearchEvaluation,evaluationFingerprint,validateResearchDataset} from '../src/domain/research-evaluation.ts';
const dataset={version:'fixture-v1',cases:[{id:'one',category:'personal',scopeId:'company-one',company:{id:'company-one',name:'Clínica Exemplo',cnpj:'11444777000161'},sources:[{id:'site',url:'https://clinica.example/equipe',text:'Clínica Exemplo. Ana Exemplo, diretora. Contato pessoal de Ana Exemplo: ana@example.com.'}],proposed:{people:[]},expected:[{subject:'Ana Exemplo',field:'person.email',value:'ana@example.com'}],mustAbstain:false}]};
const prediction=(variant:'traditional'|'hybrid')=>({caseId:'one',variant,scopeId:'company-one',task:'contact-evidence',provider:'fixture',model:'fixture',facts:[{subject:'Ana Exemplo',field:'person.email',value:'ana@example.com',sourceId:'site',quote:dataset.cases[0].sources[0].text}],costUsd:null,durationMs:2,receiptId:'receipt-'+variant});
test('one unsupported fact or cross-workspace disclosure fails regardless of aggregate precision',()=>{
 assert.equal(acceptResearchEvaluation({unsupportedFacts:1,crossTenantLeaks:0,attributionPrecision:1}),false);
 assert.equal(acceptResearchEvaluation({unsupportedFacts:0,crossTenantLeaks:1,attributionPrecision:1}),false);
 for(const attributionPrecision of [null,NaN,-1,0.949999,1.1])assert.equal(acceptResearchEvaluation({unsupportedFacts:0,crossTenantLeaks:0,attributionPrecision}),false);
 assert.equal(acceptResearchEvaluation({unsupportedFacts:0,crossTenantLeaks:0,attributionPrecision:.95}),true);
});
test('empty gold or missing predictions never pass and unknown provider cost remains unknown',()=>{
 assert.throws(()=>validateResearchDataset({...dataset,cases:[]}),/dataset/i);
 assert.throws(()=>scoreResearchEvaluation(dataset,[]),/prediction/i);
 const r=scoreResearchEvaluation(dataset,[prediction('traditional'),prediction('hybrid')]);assert.equal(r.knownCostUsd,0);assert.equal(r.costUsd,null);assert.equal(r.unknownCosts,2);assert.equal(r.coverage,1);assert.equal(r.accepted,false,'subset is diagnostic, not a full30-case release gate');
});
test('gold comparison rejects exact-looking invented contacts, wrong citations and abstention violations',()=>{
 const one=prediction('traditional'),two=prediction('hybrid');one.facts[0].value='other@example.com';const r=scoreResearchEvaluation(dataset,[one,two]);assert.equal(r.unsupportedFacts,1);assert.equal(r.accepted,false);
 const foreign={...prediction('traditional'),scopeId:'foreign-company'};assert.equal(scoreResearchEvaluation(dataset,[foreign,two]).crossTenantLeaks,1);
 const bad={...prediction('traditional'),facts:[{...prediction('traditional').facts[0],sourceId:'foreign-source'}]};assert.equal(scoreResearchEvaluation(dataset,[bad,two]).unsupportedFacts,1);
});
test('every dataset, Actor, build, model, skill and context change invalidates the fingerprint',()=>{
 const versions={actor:'maps',build:'1',model:'one',skill:'v1',context:'1',contract:'v1'},original=evaluationFingerprint(dataset,versions);
 for(const key of Object.keys(versions))assert.notEqual(evaluationFingerprint(dataset,{...versions,[key]:'changed'}),original);
 assert.notEqual(evaluationFingerprint({...dataset,version:'v2'},versions),original);
});
