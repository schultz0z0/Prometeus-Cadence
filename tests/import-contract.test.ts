import test from 'node:test';
import assert from 'node:assert/strict';
import * as importer from '../src/domain/import.ts';
import {createDemoRepository} from '../src/demo/repository.ts';
import {emptyWorkspace} from '../src/domain/empty-workspace.ts';
const api=importer as any;
test('auto mapping understands aliases, split names and all observed fields',()=>{
 const p=importer.parseContactImport('First Name;Last Name;Email;Mobile Phone;Website;Company;CNPJ;Instagram;Facebook;LinkedIn;WhatsApp;Address;City;State;Size;CNAE;Summary\nAna;Silva;ANA@example.com;(11) 99999-9999;acme.example;Acme;12.345.678/0001-90;ig;fb;li;5511999999999;Rua A;São Paulo;SP;ME;1234567;Texto');
 const mapping=api.autoMapImport(p.headers);
 const m=importer.mapImportedContacts(p,mapping,'list');
 assert.equal(m.errors.length,0);assert.equal(m.leads[0].name,'Ana Silva');assert.equal(m.leads[0].email,'ana@example.com');
 assert.equal(m.leads[0].companyName,'Acme');assert.equal((m.leads[0] as any).instagram,'ig');assert.equal((m.leads[0] as any).address,'Rua A');assert.equal((m.leads[0] as any).cnae,'1234567');assert.equal(m.leads[0].summary,'Texto');
});
test('delimiter detection ignores quoted separators and rejects inconsistent row width',()=>{
 const p=importer.parseContactImport('"name; label",email\n"Empresa; Sul",x@example.com\nOutra,x@example.com,extra');
 assert.deepEqual(p.headers,['name; label','email']);assert.equal(p.rows[0][0],'Empresa; Sul');assert.ok(p.errors.some(e=>e.line===3));
});
test('manual input recognizes key value, pipes, csv and name-only without losing first row',()=>{
 const p=api.parseManualContacts('nome=Um | email=um@example.com | cidade=Recife\nDois | dois@example.com | (81) 99999-9999 | dois.example\nTrês, tres@example.com\nQuatro');
 const m=importer.mapImportedContacts(p,api.autoMapImport(p.headers),'list');
 assert.equal(m.errors.length,0);assert.deepEqual(m.leads.map(l=>l.name),['Um','Dois','Três','Quatro']);assert.equal(m.leads[0].city,'Recife');assert.equal(m.leads[1].phone,'81999999999');
});
test('invalid mapped email and duplicate column assignments are explicit review errors',()=>{
 const p=importer.parseContactImport('Nome,Email\nAcme,not an email');
 assert.equal(importer.mapImportedContacts(p,{name:0,email:1},'list').leads.length,0);
 assert.ok(importer.mapImportedContacts(p,{name:0,email:0},'list').errors.length);
});
test('dedup compares normalized strong contacts, respects scope, never merges name or shared site',()=>{
 const make=(id:string,listId:string,fields={})=>({id,listId,name:'Same name',source:'MANUAL',qualification:'pending',createdAt:'2026-10-26T12:00:00Z',...fields});
 const existing=[make('a','other',{email:'A@EXAMPLE.COM'}),make('b','list',{cnpj:'12.345.678/0001-90'})];
 const rows=[make('c','list',{email:'a@example.com'}),make('d','list',{cnpj:'12345678000190'}),make('e','list',{phone:'(11) 99999-9999'}),make('f','list',{phone:'11999999999'}),make('g','list',{site:'https://shared.example'}),make('h','list',{site:'https://shared.example'})];
 assert.deepEqual(api.deduplicateImports(rows,existing,'workspace').leads.map((l:any)=>l.id),['e','g','h']);
 assert.deepEqual(api.deduplicateImports(rows,existing,'list').leads.map((l:any)=>l.id),['c','e','g','h']);
});
test('repository import repeats accepted identities once and creates no empty duplicate list',()=>{
 const repo=createDemoRepository(emptyWorkspace());
 const p=importer.parseContactImport('Nome,Email\nUm,um@example.com\nUm duplicado,UM@example.com');
 repo.importLeads(importer.mapImportedContacts(p,{name:0,email:1},'one').leads,{id:'one',name:'One'});
 assert.equal(repo.getSnapshot().leads.length,1);
 repo.importLeads(importer.mapImportedContacts(p,{name:0,email:1},'two').leads,{id:'two',name:'Two'});
 assert.equal(repo.getSnapshot().leads.length,1);assert.equal(repo.getSnapshot().lists.length,1);
});
test('record IDs cannot be reused in another list even when dedup scope is list',()=>{
 const repo=createDemoRepository(emptyWorkspace()),lead={id:'same',listId:'one',name:'Um',source:'MANUAL' as const,qualification:'pending' as const,createdAt:new Date().toISOString()};
 repo.importLeads([lead],{id:'one',name:'One'});repo.importLeads([{...lead,listId:'two'}],{id:'two',name:'Two'},{dedupScope:'list'});
 assert.equal(repo.getSnapshot().lists.length,1);
});
test('explicit empty-list creation remains available to existing authoring flows',()=>{const repo=createDemoRepository(emptyWorkspace());repo.importLeads([],{id:'empty',name:'Empty'});assert.equal(repo.getSnapshot().lists.length,1);});
test('malformed quotation cannot silently remove quotes or concatenate trailing text',()=>{
 for(const row of ['Acme "Sul",a@example.com','"Acme"tail,a@example.com','"Acme" "tail",a@example.com'])assert.ok(importer.parseContactImport('Name,Email\n'+row).errors.length,row);
 assert.equal(importer.parseContactImport('Name,Email\n"Acme ""Sul""",a@example.com').errors.length,0);
});
test('full CRM mapping persists business extras and named custom fields with one owner per column',()=>{
 const p=importer.parseContactImport('First Name,Last Name,Capital Social,Natureza Jurídica,Data de Abertura,Avaliação,Nº de Avaliações,Segmento\nAna,Exemplo,10000,LTDA,2020-01-01,4.5,20,SaaS');
 const mapping=api.autoMapImport(p.headers),custom={Segmento:p.headers.indexOf('Segmento')};
 const m=api.mapImportedContacts(p,mapping,'list',custom);
 assert.equal(m.errors.length,0);assert.equal(m.leads[0].name,'Ana Exemplo');assert.equal(m.leads[0].capital,'10000');assert.equal(m.leads[0].legalNature,'LTDA');assert.equal(m.leads[0].openedAt,'2020-01-01');assert.equal(m.leads[0].rating,'4.5');assert.equal(m.leads[0].reviewCount,'20');assert.deepEqual(m.leads[0].customFields,{Segmento:'SaaS'});
 assert.ok(api.mapImportedContacts(p,mapping,'list',{Segmento:mapping.name}).errors.length);
 assert.ok(api.mapImportedContacts(p,mapping,'list',JSON.parse('{"__proto__":7}')).errors.length);
});
