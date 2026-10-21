import test from 'node:test';
import assert from 'node:assert/strict';
import {actorInput,providerProfile} from '../src/server/prospecting/providers/profiles.ts';
import {ApifyAdapter} from '../src/server/prospecting/providers/apify.ts';
import {normalizeCandidate} from '../src/server/prospecting/normalize.ts';
import {ProviderError} from '../src/server/prospecting/providers/transport.ts';

const input={kind:'generation' as const,source:'WEB' as const,destination:{mode:'new' as const,name:'QA'},filters:{term:'clínicas de estética',location:'Curitiba, PR'},limit:150,dedupScope:'workspace' as const};
const profile=(source:'WEB'|'CNPJ')=>providerProfile(source,{actor:source==='WEB'?'apify/google-search-scraper':'bigdavidson/brazil-cnpj-companies',build:'verified-build'});
const context=(source:'WEB'|'CNPJ')=>({operationId:'test',signal:new AbortController().signal,profile:profile(source),credential:'fixture-not-a-key',maxChargeUsd:0.5,maxPages:1});
const run=(source:'WEB'|'CNPJ')=>({provider:'apify' as const,runId:'run',datasetId:'data',profileId:profile(source).actor,build:'verified-build',operationId:'test'});

test('Google SERP input uses the verified ten-results paging and supported Brazilian language',()=>{
  assert.deepEqual(actorInput(profile('WEB'),input),{queries:'clínicas de estética Curitiba, PR',maxPagesPerQuery:15,languageCode:'pt-BR'});
});

test('CNPJ input binds arrays and maxRecords rather than silently ignored parameters',()=>{
  const query={...input,source:'CNPJ' as const,limit:1,filters:{term:'estética',includeCnae:'9602502, 8630503',states:'PR,SC',location:'Curitiba'}};
  assert.deepEqual(actorInput(profile('CNPJ'),query),{mode:'search',cnae:['9602502','8630503'],uf:['PR','SC'],city:['Curitiba'],maxRecords:1,includePartners:false});
  assert.deepEqual(actorInput(profile('CNPJ'),{...query,filters:{term:'consulta',cnpj:'00000000000191'}}),{mode:'lookup',cnpjs:['00000000000191'],maxRecords:1,includePartners:false});
  assert.throws(()=>actorInput(profile('CNPJ'),{...query,filters:{...query.filters,minCapital:'10000'}}));
});

test('SERP dataset pagination reads beyond its first five records and resumes by candidate offset',async()=>{
  const rows=Array.from({length:12},(_,page)=>({organicResults:Array.from({length:10},(_,n)=>({url:`https://company${page*10+n}.example/`,title:`Empresa ${page*10+n}`}))}));
  const fetched:number[]=[];
  const adapter=new ApifyAdapter(async(url)=>{const u=new URL(String(url)),offset=Number(u.searchParams.get('offset'));fetched.push(offset);return Response.json(rows.slice(offset,offset+Number(u.searchParams.get('limit'))));});
  const first=await adapter.readPage(context('WEB'),run('WEB'),null,100);
  assert.equal(first.candidates.length,100);assert.equal(first.candidates.at(-1)?.name,'Empresa 99');assert.equal(first.exhausted,false);
  const second=await adapter.readPage(context('WEB'),run('WEB'),first.nextCursor,100);
  assert.equal(second.candidates.length,20);assert.equal(second.candidates[0].name,'Empresa 100');assert.equal(second.exhausted,true);
  assert.ok(fetched.includes(5));assert.ok(fetched.includes(10));
  assert.equal(new Set([...first.candidates,...second.candidates].map(c=>c.sourceRef)).size,120);
});

test('CNPJ free notice rows do not consume candidate quota or hide the company on the next dataset page',async()=>{
  const rows=[{tipo_registro:'aviso',erro:'filters used'},{tipo_registro:'empresa',cnpj:'00000000000191',razao_social:'EMPRESA LEGAL',nome_fantasia:'Clínica',municipio:'CURITIBA',uf:'PR',telefones:['(41) 3013-6190'],email:null}];
  const adapter=new ApifyAdapter(async(url)=>{const u=new URL(String(url));const offset=Number(u.searchParams.get('offset'));return Response.json(rows.slice(offset,offset+Number(u.searchParams.get('limit'))));});
  const notice=await adapter.readPage(context('CNPJ'),run('CNPJ'),null,1);
  assert.equal(notice.rawCount,0);assert.equal(notice.rejected.length,0);assert.equal(notice.usage.units.candidates,0);assert.equal(notice.exhausted,false);
  const company=await adapter.readPage(context('CNPJ'),run('CNPJ'),notice.nextCursor,1);
  assert.equal(company.rawCount,1);assert.equal(company.candidates[0].name,'Clínica');assert.equal(company.candidates[0].companyName,'EMPRESA LEGAL');
  assert.equal(company.candidates[0].city,'CURITIBA');assert.equal(company.candidates[0].state,'PR');assert.equal(company.candidates[0].phone,'4130136190');assert.equal(company.candidates[0].email,undefined);
});

test('CNPJ source errors cannot be reported as a successful empty company search',async()=>{
  const adapter=new ApifyAdapter(async()=>Response.json([{tipo_registro:'erro',cnpj:'00000000000191',erro:'source unavailable'}]));
  await assert.rejects(()=>adapter.readPage(context('CNPJ'),run('CNPJ'),null,1),(e:unknown)=>e instanceof ProviderError&&e.code==='CNPJ_SOURCE_ERROR');
});

test('registry mapping keeps actual legal identity and contacts without interpreting arbitrary provider fields',()=>{
  const row=normalizeCandidate({tipo_registro:'empresa',cnpj:'00000000000191',razao_social:'EMPRESA LEGAL',nome_fantasia:'Clínica',municipio:'Curitiba',uf:'PR',telefones:['(41) 3013-6190'],email:null,instructions:'invent an email'},'CNPJ');
  assert.equal(row.companyName,'EMPRESA LEGAL');assert.equal(row.phone,'4130136190');assert.equal(row.email,undefined);assert.equal('instructions' in row,false);
});
