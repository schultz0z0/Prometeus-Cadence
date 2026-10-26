import type {Lead} from '../domain/model.ts';
export async function collectContactExport(fetchPage:(page:number)=>Promise<{items:Lead[];total:number;revision:number}>):Promise<Lead[]>{
 const rows:Lead[]=[],ids=new Set<string>();let expected:{revision:number;total:number}|null=null;
 for(let page=1;page<=100;page++){
  const next=await fetchPage(page);if(next.total>10000)throw Error('Refine os filtros para exportar até10.000 contatos.');
  expected??={revision:next.revision,total:next.total};
  if(expected.revision!==next.revision||expected.total!==next.total||next.items.some(l=>ids.has(l.id))||!next.items.length&&rows.length<next.total)throw Error('Os contatos mudaram durante a exportação. Tente novamente.');
  for(const lead of next.items){rows.push(lead);ids.add(lead.id);}if(rows.length>=next.total)return rows;
 }throw Error('Os contatos mudaram durante a exportação. Tente novamente.');
}
export function csvCell(value:string){const safe=/^[\s]*[=+@-]/.test(value)?"'"+value:value;return '"'+safe.replaceAll('"','""')+'"';}
