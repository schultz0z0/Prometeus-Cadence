import test from 'node:test';
import assert from 'node:assert/strict';
import * as research from '../src/domain/company-research.ts';
import {parsePage} from '../src/server/prospecting/extraction/parse-page.ts';

test('unrelated domains require review even when company names could match',()=>{
 assert.equal(research.matchCompanySource({companyDomain:'clinica.example',candidateDomain:'outra.example',corroborated:false}),'review');
 assert.equal(research.matchCompanySource({companyDomain:'clinica.example',candidateDomain:'clinica.example.attacker.test',corroborated:false}),'review');
});
test('canonical same-company domain and genuine subdomain retain their source identity',()=>{
 assert.equal(research.matchCompanySource({companyDomain:'https://www.clinica.example/',candidateDomain:'https://contato.clinica.example/equipe',corroborated:false}),'matched');
 assert.equal(research.matchCompanySource({companyDomain:'',candidateDomain:'clinica.example',corroborated:false}),'review');
});
test('a public social profile needs independent company corroboration',()=>{
 assert.equal(research.matchCompanySource({companyDomain:'clinica.example',candidateDomain:'https://www.instagram.com/clinica',corroborated:false}),'review');
 assert.equal(research.matchCompanySource({companyDomain:'clinica.example',candidateDomain:'https://www.instagram.com/clinica',corroborated:true}),'matched');
 assert.equal(research.matchCompanySource({companyDomain:'clinica.example',candidateDomain:'javascript:alert(1)',corroborated:true}),'review');
 assert.equal(research.matchCompanySource({companyDomain:'https://www.instagram.com/clinica',candidateDomain:'https://www.instagram.com/outra',corroborated:false}),'review');
});
test('research rejects empty or duplicate batches and unbounded collection before execution',()=>{
 assert.throws(()=>research.parseCompanyResearchInput({leadIds:[],sourceKinds:['website'],maxPagesPerCompany:3}));
 assert.throws(()=>research.parseCompanyResearchInput({leadIds:['a','a'],sourceKinds:['website'],maxPagesPerCompany:3}));
 assert.throws(()=>research.parseCompanyResearchInput({leadIds:['a'],sourceKinds:['website'],maxPagesPerCompany:11}));
 assert.throws(()=>research.parseCompanyResearchInput({leadIds:['a'],sourceKinds:['website'],maxPagesPerCompany:3,actor:'arbitrary'}));
 assert.deepEqual(research.parseCompanyResearchInput({leadIds:['a'],sourceKinds:['website','social'],maxPagesPerCompany:10}),{leadIds:['a'],sourceKinds:['website','social'],maxPagesPerCompany:10});
});
test('contact facts keep source quotes and never assert that a published number is active WhatsApp',()=>{
 const page={id:'e1',url:'https://clinica.example/contato',fetchedAt:'2026-10-27T12:00:00Z',text:'Clínica Exemplo. Contato comercial: contato@clinica.example. Atendimento: (21) 3333-4444.',hash:'source',truncated:false};
 const facts=research.extractCompanyFacts({id:'lead1',name:'Clínica Exemplo',site:'https://clinica.example'},[page]);
 const email=facts.find(f=>f.field==='email');
 assert.equal(email?.value,'contato@clinica.example');assert.equal(email?.attribution,'company');
 assert.ok(email?.evidence[0].quote.includes('contato@clinica.example'));
 assert.equal(facts.some(f=>String(f.field)==='whatsapp'),false);
 assert.equal(facts.find(f=>f.field==='phone')?.value,'+552133334444');
});
test('unrelated pages remain evidence candidates rather than applicable company facts',()=>{
 const facts=research.extractCompanyFacts({id:'lead1',name:'Clínica Exemplo',site:'https://clinica.example'},[{id:'e2',url:'https://outra.example/',fetchedAt:'2026-10-27T12:00:00Z',text:'Contato: vendas@outra.example',hash:'source',truncated:false}]);
 assert.equal(facts.find(f=>f.field==='email')?.attribution,'uncertain');
 assert.equal(facts.find(f=>f.field==='email')?.value,'vendas@outra.example');
});
test('company social links are retained separately from same-site crawl links',()=>{
 const result=parsePage('<main>Clínica Exemplo <a href="/contato">Contato</a><a href="https://www.instagram.com/clinica">Instagram</a><a href="https://unrelated.example/offer">Anúncio</a></main>','https://clinica.example');
 assert.deepEqual(result.socialLinks,['https://www.instagram.com/clinica']);
 assert.deepEqual(result.links,['https://clinica.example/contato']);
});
test('an exact corporate registry attestation can corroborate a company without a website',()=>{
 assert.equal(research.matchCompanySource({companyDomain:'',candidateDomain:'https://api.apify.com/v2/datasets/fixture/items',corroborated:true}),'matched');
});
test('social backlinks are evidence only and cannot expand the crawl to unrelated hosts',()=>{
 const result=parsePage('<a href="https://clinica.example">Site oficial</a><a href="https://ad.example">Ad</a>','https://www.instagram.com/clinica');
 assert.deepEqual(result.links,[]);assert.ok(result.externalLinks.includes('https://clinica.example/'));
});
test('registry receipt URLs are provenance and can never replace the company website',()=>{
 const facts=research.extractCompanyFacts({id:'lead1',name:'Empresa sem site'},[{id:'reg',url:'https://api.apify.com/v2/datasets/fixture/items',text:'CNPJ da empresa e contato comercial: contato@empresa.example',hash:'reg',fetchedAt:'2026-10-27T12:00:00Z',truncated:false,sourceKind:'registry',corroborated:true}]);
 assert.ok(facts.some(f=>f.field==='email'));assert.equal(facts.some(f=>f.field==='site'),false);
});
