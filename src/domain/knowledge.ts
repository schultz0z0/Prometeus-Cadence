// Company knowledge base: pure helpers shared by ingestion (chunking) and retrieval (rank fusion, value checks).
export interface Section{label:string;text:string;table?:{header:string;rows:string[]}}
export interface ChunkDraft{ordinal:number;label:string;text:string}
const heading=(line:string)=>/^#{1,6}\s/.test(line.trim());
/** Splits a line longer than max into word-aligned pieces. */
function pieces(line:string,max:number):string[]{
 if(line.length<=max)return [line];
 const out:string[]=[];let cur='';
 for(const w of line.split(/\s+/)){if(cur&&cur.length+1+w.length>max){out.push(cur);cur='';}cur=cur?cur+' '+w:w.slice(0,max);}
 if(cur)out.push(cur);return out;
}
/** Last ~overlap characters of a chunk, starting at a word boundary. */
function tail(text:string,overlap:number){const t=text.slice(-overlap),i=t.indexOf(' ');return i<0?t:t.slice(i+1);}
/** ~600-token chunks (2400 chars) with ~80-token overlap (320 chars); tables repeat their header and never split a row. */
export function chunkSections(sections:Section[],o:{size?:number;overlap?:number}={}):ChunkDraft[]{
 const size=o.size??2400,overlap=o.overlap??320,out:ChunkDraft[]=[];
 const emit=(label:string,text:string)=>{if(text.trim())out.push({ordinal:out.length,label,text});};
 for(const s of sections){
  if(s.table){
   let rows:string[]=[];const flush=()=>{if(rows.length)emit(s.label,s.table!.header+'\n'+rows.join('\n'));rows=[];};
   for(const row of s.table.rows){const r=row.slice(0,size-s.table.header.length-1);if(rows.length&&s.table.header.length+1+[...rows,r].join('\n').length>size)flush();rows.push(r);}
   flush();
  }
  const units=s.text.split('\n').filter(l=>l.trim()).flatMap(l=>pieces(l,size-overlap-1));
  let cur:string[]=[];
  for(const u of units){
   if(cur.length&&[...cur,u].join('\n').length>size){
    const carried=heading(cur[cur.length-1])?[cur.pop()!]:[];
    const text=cur.join('\n');emit(s.label,text);
    cur=[tail(text,overlap),...carried].filter(Boolean);
    if([...cur,u].join('\n').length>size)cur=carried;
   }
   cur.push(u);
  }
  if(cur.length)emit(s.label,cur.join('\n'));
 }
 return out;
}
/** Reciprocal Rank Fusion: items found high by several searches win. */
export function fuseRanks(lists:string[][],k=60,limit=8):string[]{
 const score=new Map<string,number>();
 for(const list of lists)list.forEach((id,i)=>score.set(id,(score.get(id)??0)+1/(k+i+1)));
 return [...score.entries()].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([id])=>id);
}
/** Prices, percentages and periods a reply states; each must come from an approved source. */
export function valueMentions(text:string):string[]{
 return [...text.matchAll(/R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d+)?\s?%|\d+\s(?:dias?|semanas?|meses|mês|horas?|anos?)\b/gi)].map(m=>m[0]);
}
/** Comparable form of a value mention: 'R$ 900' and 'R$ 900,00' are the same price; 'R$ 90' and 'R$ 900' are not. */
export function valueKey(v:string):string{
 const n=(s:string)=>String(Number(s.replace(/\./g,'').replace(',','.')));
 const money=/^R\$\s?([\d.,]+)$/i.exec(v);if(money)return 'R$'+n(money[1]);
 const pct=/^([\d,]+)\s?%$/.exec(v);if(pct)return n(pct[1])+'%';
 const per=/^(\d+)\s(\S+)$/.exec(v);if(per){const u=per[2].toLowerCase();return per[1]+' '+(u.startsWith('dia')?'dia':u.startsWith('sem')?'semana':u.startsWith('m')?'mes':u.startsWith('hora')?'hora':'ano');}
 return v.toLowerCase();
}
