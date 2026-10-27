import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeCandidate} from '../src/server/prospecting/normalize.ts';
import {ApifyAdapter} from '../src/server/prospecting/providers/apify.ts';
const raw={cnpj:'12345678000190',razao_social:'Empresa Exemplo Ltda',nome_fantasia:'Exemplo',capital_social:10000,porte:'MICRO EMPRESA',natureza_juridica:'Sociedade Empresária Limitada',cnae_fiscal:6201501,data_inicio_atividade:'2020-01-02',endereco_completo:'Rua Exemplo, 1',telefones:['(21) 98888-7777'],qsa:[{nome_socio:'Ana Silva',qualificacao_socio:'Diretor',cnpj_cpf_do_socio:'***123456**',faixa_etaria:'Privado'}]};
test('registry normalization preserves useful business fields instead of dropping them',()=>{
 const c=normalizeCandidate(raw,'CNPJ');assert.equal(c.capital,'10000');assert.equal(c.size,'MICRO EMPRESA');assert.equal(c.legalNature,'Sociedade Empresária Limitada');assert.equal(c.cnae,'6201501');assert.equal(c.openedAt,'2020-01-02');assert.equal(c.address,'Rua Exemplo, 1');
 assert.equal(normalizeCandidate(c,'CNPJ').capital,'10000');
});
test('explicit partners profile retains only name and role; ordinary generation omits the QSA',async()=>{
 const adapter=new ApifyAdapter(async()=>new Response(JSON.stringify([raw]))),ctx={operationId:'op',credential:'fixture',signal:new AbortController().signal,maxChargeUsd:1,maxPages:1,profile:{source:'CNPJ' as const,actor:'bigdavidson/brazil-cnpj-companies',build:'fixture',ppe:true,partners:true}},run={provider:'apify' as const,runId:'run',datasetId:'dataset',profileId:ctx.profile.actor,build:'fixture',operationId:'op'};
 const result=await adapter.readPage(ctx,run,null,1);assert.deepEqual(result.candidates[0].facts?.decisionMakers,[{name:'Ana Silva',role:'Diretor'}]);const safe=JSON.stringify(result);assert.equal(safe.includes('123456**'),false);assert.equal(safe.includes('Privado'),false);
 const ordinary=await adapter.readPage({...ctx,profile:{...ctx.profile,partners:false}},run,null,1);assert.equal(ordinary.candidates[0].facts?.decisionMakers,undefined);
});
