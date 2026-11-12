import test from 'node:test';
import assert from 'node:assert/strict';
import {matchRegistryFirst as match} from './cnpj-first.ts';
const maps={name:'[RE] Alfa Esquadrias',source:'MAPS' as const,sourceRef:'fake-maps',city:'Campinas',state:'São Paulo',phone:'+5511999991234',address:'Rua Exemplo, 10',site:'https://alfa.example.com/'};
const registry={...maps,source:'CNPJ' as const,sourceRef:'fake-cadastro',state:'SP',cnpj:'37297479000180',facts:{registrationStatus:'ATIVA'}};
const pages=[{id:'fake-site',url:maps.site,text:'Alfa Esquadrias. Ligue (11) 99999-1234.',hash:'fake',fetchedAt:'2026-11-08T12:00:00Z',truncated:false}];

test('registry first admits the confirmed establishment even when its site omits the CNPJ',()=>{
 assert.equal(match(maps,[registry],pages)?.cnpj,registry.cnpj);
});

test('street abbreviations preserve the match without masking a different building number',()=>{
 const abbreviated={...maps,address:'R. Srg. Exemplo, 10'};
 const full={...registry,address:'Rua Sargento Exemplo, 10',phone:'5511999994321'};
 assert.equal(match(abbreviated,[full],pages)?.cnpj,full.cnpj);
 assert.equal(match({...abbreviated,address:'R. Srg. Exemplo, 11'},[full],pages),null);
});

test('homonyms, conflicting branches, invalid registrations and ambiguous matches stay unlinked',()=>{
 assert.equal(match(maps,[{...registry,phone:'5511999994321',address:'Rua Outro Exemplo, 11'}],pages),null);
 assert.equal(match(maps,[{...registry,address:'Rua Exemplo, 20'}],pages),null);
 assert.equal(match(maps,[{...registry,cnpj:'33000167000101',address:undefined}],pages),null);
 assert.equal(match(maps,[{...registry,city:'Valinhos'}],pages),null);
 assert.equal(match(maps,[{...registry,cnpj:'37297479000181'}],pages),null);
 assert.equal(match(maps,[{...registry,facts:{registrationStatus:'BAIXADA'}}],pages),null);
 assert.equal(match(maps,[registry,{...registry,cnpj:'33000167000101'}],pages),null);
 assert.equal(match(maps,[registry],[{...pages[0],text:pages[0].text+' CNPJ 33.000.167/0001-01'}]),null);
 assert.equal(match(maps,[registry],[{...pages[0],url:'https://outro.example.com/'}]),null);
});
