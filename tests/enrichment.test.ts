import test from 'node:test';import assert from 'node:assert/strict';
import {validateDecisorEvidence,personalContactKey} from '../src/domain/enrichment.ts';
import type {Evidence} from '../src/domain/prospecting.ts';
const text='Empresa Exemplo: Ana Silva, diretora comercial. Contato pessoal de Ana Silva: ana.silva@example.com, celular (21) 98888-7777. Perfil https://www.linkedin.com/in/ana-exemplo/.';
const evidence:Evidence[]=[{id:'e1',url:'https://empresa.example/equipe',text,hash:'hash',fetchedAt:'2026-10-26T20:00:00Z',truncated:false}];
const company={name:'Empresa Exemplo',email:'contato@empresa.example',phone:'+5521999999999'};
const person={name:'Ana Silva',role:'diretora comercial',email:'ana.silva@example.com',phone:'(21) 98888-7777',evidenceId:'e1',quote:text};
test('decision maker contact requires the literal cited public evidence, person and company context',()=>{
 const people=validateDecisorEvidence({people:[person]},evidence,company);assert.equal(people.length,1);assert.equal(people[0].phone,'+5521988887777');assert.equal(people[0].whatsapp,'unverified');assert.equal(people[0].evidenceId,'e1');
 for(const patch of [{evidenceId:'unknown'},{name:'Bruno Nunca'},{email:'inventado@example.com'},{quote:'Invented '+text},{role:'CEO não citado'}])assert.equal(validateDecisorEvidence({people:[{...person,...patch}]},evidence,company).length,0);
});
test('generic company contacts and QSA names alone are not useful personal-contact results',()=>{
 assert.equal(validateDecisorEvidence({people:[{...person,phone:undefined,email:undefined}]},evidence,company).length,0);
 const generic='Empresa Exemplo: Ana Silva, diretora comercial. Contato pessoal de Ana Silva: contato@empresa.example, celular (21) 99999-9999.';
 assert.equal(validateDecisorEvidence({people:[{...person,email:'contato@empresa.example',phone:'+5521999999999',quote:generic}]},[{...evidence[0],text:generic}],company).length,0);
});
test('decision maker parsing is bounded, strips no unknown claims, and deduplicates contacts',()=>{
 assert.equal(validateDecisorEvidence({people:[person,person]},evidence,company).length,1);
 assert.throws(()=>validateDecisorEvidence({people:[{...person,cpf:'12345678900'}]},evidence,company));
 assert.throws(()=>validateDecisorEvidence({people:Array(11).fill(person)},evidence,company));
 assert.equal(personalContactKey({name:'Ana Silva',phone:'21988887777'}),personalContactKey({name:'ANA SILVA',phone:'+5521988887777'}));
});
test('a differently formatted phone cannot skip the personal attribution distance check',()=>{
 const quote='Empresa Exemplo: Ana Silva, diretora comercial. '+'. '.repeat(220)+'Telefone geral de outra equipe (21) 98888-7777.';
 assert.equal(validateDecisorEvidence({people:[{...person,email:undefined,phone:'21988887777',quote}]},[{...evidence[0],text:quote}],company).length,0);
});
test('a nearby corporate phone is not personal and an explicitly attributed phone cannot reuse a known registry corporate number',()=>{
 const quote='Empresa Exemplo: Ana Silva, diretora comercial. Telefone geral da empresa: (21) 98888-7777.';
 assert.equal(validateDecisorEvidence({people:[{...person,email:undefined,phone:'21988887777',quote}]},[{...evidence[0],text:quote}],{name:'Empresa Exemplo'}).length,0);
 assert.equal(validateDecisorEvidence({people:[person]},evidence,company,[],['+5521988887777']).length,0);
});
