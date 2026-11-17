import test from 'node:test';import assert from 'node:assert/strict';
import {createRegistryLookup,registryPhone} from '../src/server/prospecting/providers/registry.ts';
import {registryDecisionMakers} from '../src/domain/enrichment.ts';
// 17/11/2026: one-CNPJ lookups go to CNPJá first, then the public OpenCNPJ API.
const CNPJ='33000167000101',signal=new AbortController().signal;
const cnpja={taxId:CNPJ,alias:'Petrobras',founded:'1966-09-28',status:{id:2,text:'Ativa'},
 company:{name:'PETROLEO BRASILEIRO S A PETROBRAS',equity:205431960490.52,nature:{text:'Sociedade de Economia Mista'},size:{text:'Demais'},
  members:[{person:{name:'MAGDA MARIA DE REGINA CHAMBRIARD',type:'NATURAL'},role:{text:'Presidente'}}]},
 address:{street:'Avenida Henrique Valadares',number:'28',district:'Centro',city:'Rio de Janeiro',state:'RJ',zip:'20231030'},
 phones:[{type:'LANDLINE',area:'21',number:'21660000'}],emails:[{address:'Contato@Petrobras.com.br'}],mainActivity:{id:600001,text:'Extração de petróleo e gás natural'}};
const open={cnpj:CNPJ,razao_social:'PETROLEO BRASILEIRO S A PETROBRAS',nome_fantasia:'PETROBRAS',situacao_cadastral:'Ativa',data_inicio_atividade:'1966-09-28',cnae_principal:'0600001',
 tipo_logradouro:'AVENIDA',logradouro:'HENRIQUE VALADARES',numero:'28',bairro:'CENTRO',cep:'20231030',uf:'RJ',municipio:'RIO DE JANEIRO',email:'Contato@Petrobras.com.br',
 telefones:[{ddd:'21',numero:'32240000',is_fax:true},{ddd:'21',numero:'21660000',is_fax:false}],QSA:[{nome_socio:'MAGDA MARIA DE REGINA CHAMBRIARD',qualificacao_socio:'Presidente'}]};
function fake(routes:{cnpja?:number|object;open?:number|object}){
 const calls:{url:string;auth:string|null}[]=[];
 const fetcher=(async(url:string,init:RequestInit)=>{
  calls.push({url,auth:new Headers(init.headers).get('authorization')});
  const r=url.startsWith('https://api.cnpja.com/')?routes.cnpja:routes.open;
  return typeof r==='number'?new Response('{"message":"x"}',{status:r}):new Response(JSON.stringify(r),{status:200});
 }) as typeof fetch;
 return {calls,fetcher};
}
test('cnpja first: maps the company and records the source',async()=>{
 const f=fake({cnpja}),{provider,candidate:c}=await createRegistryLookup({fetcher:f.fetcher,apiKey:'KEY'})(CNPJ,{partners:false,signal});
 assert.equal(provider,'cnpja');
 assert.deepEqual(f.calls,[{url:`https://api.cnpja.com/office/${CNPJ}?strategy=CACHE_IF_FRESH&maxAge=45`,auth:'KEY'}]);
 assert.equal(c.name,'Petrobras');assert.equal(c.companyName,'PETROLEO BRASILEIRO S A PETROBRAS');assert.equal(c.cnpj,CNPJ);assert.equal(c.source,'CNPJ');assert.equal(c.sourceRef,CNPJ);
 assert.equal(c.city,'Rio de Janeiro');assert.equal(c.state,'RJ');assert.equal(c.phone,'2121660000');assert.equal(c.email,'contato@petrobras.com.br');
 assert.equal(c.cnae,'0600001');assert.equal(c.openedAt,'1966-09-28');
 assert.equal(c.facts?.registrationStatus,'ATIVA');assert.equal(c.facts?.street,'Avenida Henrique Valadares, 28');assert.equal(c.facts?.decisionMakers,undefined);
 assert.equal(c.evidence?.[0].url,`https://cnpja.com/office/${CNPJ}`);assert.match(c.evidence![0].text,/PETROBRAS/);
});
test('partners:true maps members to decisionMakers',async()=>{
 const {candidate}=await createRegistryLookup({fetcher:fake({cnpja}).fetcher,apiKey:'KEY'})(CNPJ,{partners:true,signal});
 assert.deepEqual(candidate.facts?.decisionMakers,[{name:'MAGDA MARIA DE REGINA CHAMBRIARD',role:'Presidente'}]);
});
test('cnpja 429 falls back to opencnpj',async()=>{
 const f=fake({cnpja:429,open}),{provider,candidate:c}=await createRegistryLookup({fetcher:f.fetcher,apiKey:'KEY'})(CNPJ,{partners:true,signal});
 assert.equal(provider,'opencnpj');assert.equal(c.evidence?.[0].url,`https://opencnpj.org/${CNPJ}`);
 assert.equal(c.phone,'2121660000');assert.equal(c.name,'PETROBRAS');assert.equal(c.facts?.registrationStatus,'ATIVA');assert.equal(c.facts?.street,'AVENIDA HENRIQUE VALADARES, 28');
 assert.deepEqual(c.facts?.decisionMakers,[{name:'MAGDA MARIA DE REGINA CHAMBRIARD',role:'Presidente'}]);
 assert.equal(f.calls.at(-1)?.url,`https://api.opencnpj.org/${CNPJ}`);assert.equal(f.calls.at(-1)?.auth,null);
});
test('not found in both → CNPJ_NOT_FOUND',async()=>{
 await assert.rejects(createRegistryLookup({fetcher:fake({cnpja:404,open:404}).fetcher,apiKey:'KEY'})(CNPJ,{partners:false,signal}),{code:'CNPJ_NOT_FOUND'});
});
test('cnpja broken and opencnpj 404 → CNPJ_NOT_FOUND',async()=>{
 await assert.rejects(createRegistryLookup({fetcher:fake({cnpja:401,open:404}).fetcher,apiKey:'KEY'})(CNPJ,{partners:false,signal}),{code:'CNPJ_NOT_FOUND'});
});
test('both 500 → CNPJ_SOURCE_ERROR, not uncertain',async()=>{
 await assert.rejects(createRegistryLookup({fetcher:fake({cnpja:500,open:500}).fetcher,apiKey:'KEY'})(CNPJ,{partners:false,signal}),(e:{code:string;uncertain:boolean})=>e.code==='CNPJ_SOURCE_ERROR'&&e.uncertain===false);
});
test('a body without identity counts as a provider failure',async()=>{
 const {provider}=await createRegistryLookup({fetcher:fake({cnpja:{taxId:'00000000000000'},open}).fetcher,apiKey:'KEY'})(CNPJ,{partners:false,signal});
 assert.equal(provider,'opencnpj');
});
test('no api key → only opencnpj is called',async()=>{
 const f=fake({cnpja,open});await createRegistryLookup({fetcher:f.fetcher,apiKey:null})(CNPJ,{partners:false,signal});
 assert.ok(f.calls.every(c=>c.url.startsWith('https://api.opencnpj.org/')));
});
test('error messages never contain the api key',async()=>{
 await assert.rejects(createRegistryLookup({fetcher:fake({cnpja:500,open:500}).fetcher,apiKey:'SECRET-KEY-123'})(CNPJ,{partners:false,signal}),(e:Error)=>!String(e.message+e.stack).includes('SECRET-KEY-123'));
});
test('invalid cnpj → CNPJ_NOT_FOUND without any fetch',async()=>{
 const f=fake({cnpja,open});
 await assert.rejects(createRegistryLookup({fetcher:f.fetcher,apiKey:'KEY'})('abc',{partners:false,signal}),{code:'CNPJ_NOT_FOUND'});
 assert.equal(f.calls.length,0);
});
test('registryPhone adds the mobile 9',()=>{
 assert.equal(registryPhone('21','96434276'),'21996434276');assert.equal(registryPhone('21','21660000'),'2121660000');
 assert.equal(registryPhone('21','996434276'),'21996434276');assert.equal(registryPhone('11',''),undefined);
});
test('MEI: the company name keeps the owner for registryDecisionMakers',async()=>{
 const mei={...open,razao_social:'12.345.678 FULANO DE TAL',nome_fantasia:'',QSA:[]};
 const {candidate}=await createRegistryLookup({fetcher:fake({open:mei}).fetcher,apiKey:null})(CNPJ,{partners:true,signal});
 assert.equal(candidate.companyName,'12.345.678 FULANO DE TAL');assert.equal(candidate.name,'12.345.678 FULANO DE TAL');
 assert.deepEqual(registryDecisionMakers(candidate),[{name:'FULANO DE TAL',role:'Titular (MEI)'}]);
});
