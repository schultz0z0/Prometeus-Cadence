// Generates the small knowledge-base fixtures used by tests/knowledge-extract.test.ts. Run once: node scripts/fixtures/knowledge-fixtures.mjs
import {writeFileSync,mkdirSync} from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
const dir='tests/fixtures/knowledge/';mkdirSync(dir,{recursive:true});
const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Serviços');
ws.addRow(['Serviço','Preço','Prazo']);ws.addRow(['Agente SDR','R$ 900,00','15 dias']);ws.addRow(['Automação de cobrança','R$ 1.500,00','30 dias']);
wb.addWorksheet('Vazia');
writeFileSync(dir+'tabela.xlsx',Buffer.from(await wb.xlsx.writeBuffer()));
const zip=new JSZip();
zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
zip.file('word/document.xml','<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Script comercial</w:t></w:r></w:p><w:p><w:r><w:t>Pergunte quantas pessoas trabalham na empresa.</w:t></w:r></w:p></w:body></w:document>');
writeFileSync(dir+'script.docx',await zip.generateAsync({type:'nodebuffer'}));
function pdf(content){
 const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let out='%PDF-1.4\n';const offs=[];
 objs.forEach((o,i)=>{offs.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const x=out.length;out+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`+offs.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
 return Buffer.from(out,'latin1');
}
writeFileSync(dir+'apresentacao.pdf',pdf('BT /F1 12 Tf 20 150 Td (Prometeus cria agentes de IA) Tj ET'));
writeFileSync(dir+'escaneado.pdf',pdf('0 0 1 rg 10 10 100 100 re f'));
writeFileSync(dir+'notas.md','# Notas\n\nAtendemos clínicas e escritórios.\n');
writeFileSync(dir+'precos.csv','Serviço;Preço\nAgente SDR;R$ 900,00\n');
console.log('ok');
