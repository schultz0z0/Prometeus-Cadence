import test from 'node:test';import assert from 'node:assert/strict';
import {classifyPersonContact,resolveIdentityCandidates,reviewCompanyPeople,sanitizePeopleSource} from '../src/domain/company-people.ts';
const evidence={id:'source',url:'https://clinica.example/equipe',fetchedAt:'2026-10-27T12:00:00Z',hash:'hash',sourceVersion:'company-people-v1',quote:'Clínica Exemplo. Ana Exemplo, diretora comercial. Contato pessoal de Ana Exemplo: ana@example.com.'};
test('personal contact needs explicit attribution and source; corporate contact never becomes personal',()=>{
 assert.equal(classifyPersonContact({attributed:false,corporate:false,hasSource:true}),'unresolved');
 assert.equal(classifyPersonContact({attributed:true,corporate:true,hasSource:true}),'corporate');
 assert.equal(classifyPersonContact({attributed:true,corporate:false,hasSource:false}),'unresolved');
 assert.equal(classifyPersonContact({attributed:true,corporate:false,hasSource:true}),'personal');
});
test('homonymous legal entities and differing full branch identifiers cannot silently resolve',()=>{
 const lead={name:'Clínica Exemplo',site:'https://clinica.example',cnpj:'11444777000161'};
 assert.equal(resolveIdentityCandidates('case',lead,[{cnpj:'11444777000161',legalName:'Clínica Exemplo',corroborated:true,evidence:[evidence]},{cnpj:'11222333000181',legalName:'Clínica Exemplo',corroborated:true,evidence:[evidence]}]).state,'conflict');
 assert.equal(resolveIdentityCandidates('case',lead,[{cnpj:'11222333000181',legalName:'Clínica Exemplo',corroborated:true,evidence:[evidence]}]).state,'conflict');
 assert.equal(resolveIdentityCandidates('case',lead,[]).state,'missing');
});
test('a manager is distinct from a shareholder and a shareholder without contact remains a person',()=>{
 const partnerSource={...evidence,id:'registry',quote:'Clínica Exemplo. Bruno Exemplo, Sócio administrador.'};
 const result=reviewCompanyPeople({company:{id:'lead',name:'Clínica Exemplo',site:'https://clinica.example'},identity:{caseId:'case',cnpj:'11444777000161',legalName:'Clínica Exemplo',state:'resolved',evidence:[evidence]},sources:[evidence,partnerSource],partners:[{name:'Bruno Exemplo',role:'Sócio administrador',evidence:partnerSource}],proposed:{people:[{name:'Ana Exemplo',role:'diretora comercial',evidenceId:'source',quote:evidence.quote,email:'ana@example.com'}]}});
 assert.equal(result.find(p=>p.name==='Ana Exemplo')?.relationship,'manager');assert.equal(result.find(p=>p.name==='Ana Exemplo')?.contacts[0].attribution,'personal');
 assert.equal(result.find(p=>p.name==='Bruno Exemplo')?.relationship,'partner');assert.deepEqual(result.find(p=>p.name==='Bruno Exemplo')?.contacts,[]);
});
test('generic and merely adjacent contact details cannot become useful personal resolution',()=>{
 const source={...evidence,quote:'Clínica Exemplo. Ana Exemplo, diretora comercial. Telefone geral da empresa: (21) 3333-4444. contato@clinica.example'};
 const result=reviewCompanyPeople({company:{id:'lead',name:'Clínica Exemplo',site:'https://clinica.example',phone:'2133334444',email:'contato@clinica.example'},identity:{caseId:'case',cnpj:'11444777000161',legalName:'Clínica Exemplo',state:'resolved',evidence:[source]},sources:[source],partners:[],proposed:{people:[{name:'Ana Exemplo',role:'diretora comercial',evidenceId:'source',quote:source.quote,email:'contato@clinica.example',phone:'2133334444'}]}});
 assert.equal(result[0]?.name,'Ana Exemplo');assert.ok(result[0].contacts.every(c=>c.attribution!=='personal'));
});
test('source preparation redacts CPF and age without inventing a phone or changing the company CNPJ',()=>{
 const text=sanitizePeopleSource('Clínica CNPJ 11.444.777/0001-61. Ana Exemplo, CPF 123.456.789-09, 47 anos. Contato pessoal de Ana Exemplo: ana@example.com.');
 assert.ok(!text.includes('123.456.789-09'));assert.ok(!text.includes('47 anos'));assert.ok(text.includes('11.444.777/0001-61'));assert.ok(text.includes('ana@example.com'));
});
test('a detached registry quote cannot create a supported shareholder',()=>{
 const result=reviewCompanyPeople({company:{id:'lead',name:'Clínica Exemplo'},identity:{caseId:'case',cnpj:'11444777000161',legalName:'Clínica Exemplo',state:'resolved',evidence:[evidence]},sources:[evidence],partners:[{name:'Bruno Exemplo',role:'Sócio administrador',evidence:{...evidence,id:'invented',quote:'Clínica Exemplo. Bruno Exemplo, Sócio administrador.'}}],proposed:{people:[]}});assert.deepEqual(result,[]);
});
test('former roles are retained as uncertain and never become an applicable current personal contact',()=>{
 const source={...evidence,quote:'Clínica Exemplo. Ana Exemplo, ex-diretora comercial. Contato pessoal de Ana Exemplo: ana@example.com.'};
 const people=reviewCompanyPeople({company:{id:'lead',name:'Clínica Exemplo'},identity:{caseId:'case',cnpj:'11444777000161',legalName:'Clínica Exemplo',state:'resolved',evidence:[source]},sources:[source],partners:[],proposed:{people:[{name:'Ana Exemplo',role:'ex-diretora comercial',email:'ana@example.com',evidenceId:source.id,quote:source.quote}]}});assert.equal(people[0].current,'uncertain');assert.ok(people[0].contacts.every(c=>c.attribution!=='personal'));
});
