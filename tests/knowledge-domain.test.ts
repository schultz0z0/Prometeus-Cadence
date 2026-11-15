import test from 'node:test';import assert from 'node:assert/strict';
import {chunkSections,fuseRanks,valueMentions} from '../src/domain/knowledge.ts';
const words=(n:number,w='palavra')=>Array.from({length:n},(_,i)=>w+i).join(' ');
test('long text becomes overlapping chunks within the size limit',()=>{
 const chunks=chunkSections([{label:'Proposta',text:words(1500)}]);
 assert.ok(chunks.length>=5);
 for(const c of chunks)assert.ok(c.text.length<=2400,String(c.text.length));
 const tail=chunks[0].text.slice(-200),head=chunks[1].text.slice(0,400);
 assert.ok(head.includes(tail.split(' ').slice(-5).join(' ')),'consecutive chunks overlap');
 assert.deepEqual(chunks.map(c=>c.ordinal),chunks.map((_,i)=>i));
});
test('a heading never ends a chunk on its own',()=>{
 const text=[words(330,'a'),'## Preços',words(300,'b')].join('\n');
 for(const c of chunkSections([{label:'Doc',text}]))assert.ok(!c.text.trimEnd().endsWith('## Preços'));
});
test('tables repeat the header in every chunk and never split a row',()=>{
 const rows=Array.from({length:200},(_,i)=>`Serviço ${i} | R$ ${i*10},00 | ${i} dias`);
 const chunks=chunkSections([{label:'Tabela',text:'',table:{header:'Serviço | Preço | Prazo',rows}}]);
 assert.ok(chunks.length>1);
 for(const c of chunks){assert.ok(c.text.startsWith('Serviço | Preço | Prazo\n'));for(const line of c.text.split('\n').slice(1))assert.match(line,/^Serviço \d+ \| R\$ \d+,00 \| \d+ dias$/);}
 assert.equal(chunks.flatMap(c=>c.text.split('\n').slice(1)).length,200);
});
test('rank fusion favours items found by several searches',()=>{
 assert.equal(fuseRanks([['a','b'],['b','c']])[0],'b');
 assert.equal(fuseRanks([Array.from({length:30},(_,i)=>'x'+i)]).length,8);
});
test('value mentions find money, percentages and periods',()=>{
 assert.deepEqual(valueMentions('custa R$ 1.500,00 e 10% em 30 dias'),['R$ 1.500,00','10%','30 dias']);
 assert.deepEqual(valueMentions('oi, tudo bem?'),[]);
});
