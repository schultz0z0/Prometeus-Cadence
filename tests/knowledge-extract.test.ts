import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {extractDocument} from '../src/server/knowledge/extract.ts';
const f=(n:string)=>new Uint8Array(readFileSync('tests/fixtures/knowledge/'+n));
const never=async()=>{throw new Error('transcription not expected');};
const all=(r:{sections:{text:string;table?:{header:string;rows:string[]}}[]})=>r.sections.map(s=>s.text+(s.table?s.table.header+'\n'+s.table.rows.join('\n'):'')).join('\n');
test('pdf with a text layer is read locally',async()=>{
 const r=await extractDocument(f('apresentacao.pdf'),'application/pdf',{transcribePdf:never});
 assert.equal(r.pages,1);assert.match(all(r),/Prometeus cria agentes de IA/);
});
test('a scanned pdf goes to transcription once',async()=>{
 let calls=0;const r=await extractDocument(f('escaneado.pdf'),'application/pdf',{transcribePdf:async()=>{calls++;return 'Tabela escaneada: Agente SDR R$ 900,00';}});
 assert.equal(calls,1);assert.match(all(r),/Agente SDR R\$ 900,00/);
});
test('word, markdown and csv become text sections',async()=>{
 assert.match(all(await extractDocument(f('script.docx'),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',{transcribePdf:never})),/Pergunte quantas pessoas trabalham/);
 assert.match(all(await extractDocument(f('notas.md'),'text/markdown',{transcribePdf:never})),/Atendemos clínicas/);
 const csv=await extractDocument(f('precos.csv'),'text/csv',{transcribePdf:never});
 assert.equal(csv.sections[0].table?.header,'Serviço | Preço');assert.deepEqual(csv.sections[0].table?.rows,['Agente SDR | R$ 900,00']);
});
test('each spreadsheet tab becomes a table with its header',async()=>{
 const r=await extractDocument(f('tabela.xlsx'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',{transcribePdf:never});
 const t=r.sections.find(s=>s.label==='Serviços')?.table;
 assert.equal(t?.header,'Serviço | Preço | Prazo');assert.deepEqual(t?.rows,['Agente SDR | R$ 900,00 | 15 dias','Automação de cobrança | R$ 1.500,00 | 30 dias']);
 assert.equal(r.sections.some(s=>s.label==='Vazia'),false);
});
test('too many pages and mismatched bytes are refused',async()=>{
 const kids=Array.from({length:301},(_,i)=>`${i+3} 0 R`).join(' ');
 let body='%PDF-1.4\n';const offs:number[]=[];const add=(o:string)=>{offs.push(body.length);body+=`${offs.length} 0 obj\n${o}\nendobj\n`;};
 add('<< /Type /Catalog /Pages 2 0 R >>');add(`<< /Type /Pages /Kids [${kids}] /Count 301 >>`);
 for(let i=0;i<301;i++)add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>');
 const x=body.length;body+=`xref\n0 ${offs.length+1}\n0000000000 65535 f \n`+offs.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${offs.length+1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
 await assert.rejects(extractDocument(new TextEncoder().encode(body),'application/pdf',{transcribePdf:never}),/KNOWLEDGE_TOO_MANY_PAGES/);
 await assert.rejects(extractDocument(f('precos.csv'),'application/pdf',{transcribePdf:never}),/KNOWLEDGE_UNREADABLE/);
 await assert.rejects(extractDocument(f('precos.csv'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',{transcribePdf:never}),/KNOWLEDGE_UNREADABLE/);
});
