import {extractText,getDocumentProxy} from 'unpdf';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import type {Section} from '../../domain/knowledge.ts';
// Text extraction for the company knowledge base. Runs in the worker only; no macros, no network.
export type KnowledgeMime='application/pdf'|'application/vnd.openxmlformats-officedocument.wordprocessingml.document'|'text/plain'|'text/markdown'|'text/csv'|'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MAX_PDF_PAGES=300;
const unreadable=()=>new Error('KNOWLEDGE_UNREADABLE');
const utf8=(b:Uint8Array)=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(b).replace(/^﻿/,'');}catch{throw unreadable();}};
/** Splits a CSV line on the delimiter, outside double quotes. */
function cells(line:string,d:string){const out:string[]=[];let cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(ch===d&&!q){out.push(cur.trim());cur='';}else cur+=ch;}out.push(cur.trim());return out;}
function table(label:string,rows:string[][]):Section|null{
 const filled=rows.filter(r=>r.some(c=>c));if(filled.length<2)return null;
 return {label,text:'',table:{header:filled[0].join(' | '),rows:filled.slice(1).map(r=>r.join(' | '))}};
}
export async function extractDocument(bytes:Uint8Array,mime:KnowledgeMime,deps:{transcribePdf:(bytes:Uint8Array)=>Promise<string>}):Promise<{pages:number;sections:Section[]}>{
 if(mime==='application/pdf'){
  let pdf;try{pdf=await getDocumentProxy(new Uint8Array(bytes));}catch{throw unreadable();}
  if(pdf.numPages>MAX_PDF_PAGES)throw new Error('KNOWLEDGE_TOO_MANY_PAGES');
  const {text}=await extractText(pdf,{mergePages:false}) as {text:string[]};
  if(text.join('').replace(/\s/g,'').length<20){const t=(await deps.transcribePdf(bytes)).trim();if(!t)throw unreadable();return {pages:pdf.numPages,sections:[{label:'Documento',text:t}]};}
  return {pages:pdf.numPages,sections:text.map((t,i)=>({label:'Página '+(i+1),text:t.trim()})).filter(s=>s.text)};
 }
 if(mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'){
  let value:string;try{value=(await mammoth.extractRawText({buffer:Buffer.from(bytes)})).value;}catch{throw unreadable();}
  if(!value.trim())throw unreadable();return {pages:1,sections:[{label:'Documento',text:value.replace(/\n{2,}/g,'\n').trim()}]};
 }
 if(mime==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'){
  const wb=new ExcelJS.Workbook();try{await wb.xlsx.load(Buffer.from(bytes) as never);}catch{throw unreadable();}
  const sections=wb.worksheets.map(ws=>{const rows:string[][]=[];ws.eachRow({includeEmpty:false},row=>{const r:string[]=[];for(let c=1;c<=ws.columnCount;c++)r.push(row.getCell(c).text.trim());rows.push(r);});return table(ws.name,rows);}).filter((s):s is Section=>!!s);
  if(!sections.length)throw unreadable();return {pages:sections.length,sections};
 }
 if(mime==='text/csv'){
  const lines=utf8(bytes).split(/\r?\n/).filter(l=>l.trim());const d=(lines[0]?.split(';').length??0)>(lines[0]?.split(',').length??0)?';':',';
  const s=table('Planilha',lines.map(l=>cells(l,d)));if(!s)throw unreadable();return {pages:1,sections:[s]};
 }
 if(mime==='text/plain'||mime==='text/markdown'){const t=utf8(bytes).trim();if(!t)throw unreadable();return {pages:1,sections:[{label:'Documento',text:t}]};}
 throw new Error('KNOWLEDGE_TYPE');
}
