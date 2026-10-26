import type { Lead } from './model.ts';
export const importFields = {name:'Nome',lastName:'Sobrenome',email:'E-mail',phone:'Telefone',site:'Site',instagram:'Instagram',facebook:'Facebook',linkedin:'LinkedIn',whatsapp:'WhatsApp',address:'Endereço',city:'Cidade',state:'Estado',cnpj:'CNPJ',companyName:'Razão social',size:'Porte',capital:'Capital social',legalNature:'Natureza jurídica',cnae:'CNAE',openedAt:'Data de abertura',summary:'Resumo',rating:'Avaliação (nota)',reviewCount:'Nº de avaliações'} as const;
export type ImportField=keyof typeof importFields;
export type ImportMapping=Partial<Record<ImportField,number>>;
export interface ImportPreview {headers:string[];rows:string[][];errors:{line:number;message:string}[];lines?:number[]}
const key=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases:Record<ImportField,string[]>={
 name:['nome','name','first name','first_name','full name','nome completo','empresa','contact name'],lastName:['sobrenome','last name','last_name'],email:['email','e-mail','email address','e-mail address','primary email','email 1 value'],phone:['telefone','phone','mobile phone','phone number','celular','fone','phone 1 value','telefone 1'],site:['site','website','company website','domain','url'],instagram:['instagram'],facebook:['facebook'],linkedin:['linkedin','linkedin url','company linkedin url','person linkedin url'],whatsapp:['whatsapp','whats app'],address:['endereco','address','street address','company address'],city:['cidade','city','company city'],state:['estado','state','uf','company state'],cnpj:['cnpj','documento'],companyName:['razao social','razao_social','company','company name','organization name'],size:['porte','size','company size'],capital:['capital social','capital'],legalNature:['natureza juridica','legal nature'],openedAt:['data de abertura','opening date'],rating:['avaliacao','avaliacao nota','rating'],reviewCount:['nº de avaliações','numero de avaliacoes','review count','reviews count'],cnae:['cnae','cnae principal'],summary:['resumo','summary','description','descricao'],
};
export function autoMapImport(headers:string[]):ImportMapping{
 const mapping:ImportMapping={},used=new Set<number>();
 for(const field of Object.keys(aliases) as ImportField[]){if(field==='lastName'&&headers[0]==='Nome'&&headers.some(h=>key(h)==='firstname'))continue;const index=headers.findIndex((h,i)=>!used.has(i)&&aliases[field].some(a=>key(a)===key(h)));if(index>=0){mapping[field]=index;used.add(index);}}return mapping;
}
function delimiterOf(first:string){
 const counts=new Map([['\t',0],[';',0],[',',0]]);let quoted=false;
 for(let i=0;i<first.length;i++){const c=first[i];if(c==='"'){if(quoted&&first[i+1]==='"')i++;else quoted=!quoted;}else if(!quoted&&counts.has(c))counts.set(c,counts.get(c)!+1);}
 const sorted=[...counts].sort((a,b)=>b[1]-a[1]);return sorted[0][1]?sorted[0][0]:',';
}
export function parseContactImport(text:string):ImportPreview{
 const input=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'),delimiter=delimiterOf(input.split('\n')[0]??'');
 const rows:string[][]=[],lines:number[]=[],errors:ImportPreview['errors']=[];let row:string[]=[],cell='',quoted=false,closed=false,line=1,start=1,quoteLine=1;
 const push=()=>{row.push(cell.trim());if(row.some(Boolean)){rows.push(row);lines.push(start);}row=[];cell='';closed=false;};
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(c==='"'){
   if(quoted&&input[i+1]==='"'){cell+='"';i++;}
   else if(quoted){quoted=false;closed=true;}
   else if(cell.trim()||closed){errors.push({line,message:'Aspas em posição inválida. Use aspas duplas para escapar uma aspa dentro do campo.'});cell+='"';}
   else{quoted=true;quoteLine=line;}
  }else if(c===delimiter&&!quoted){row.push(cell.trim());cell='';closed=false;}
  else if(c==='\n'&&!quoted){push();line++;start=line;}
  else{if(closed&&!/\s/.test(c))errors.push({line,message:'Há texto depois do fechamento das aspas.'});cell+=c;if(c==='\n')line++;}
 }
 if(quoted)errors.push({line:quoteLine,message:'Aspas não foram fechadas.'});push();const headers=rows.shift()??[];lines.shift();
 if(!headers.length)errors.push({line:1,message:'Adicione um cabeçalho e pelo menos um contato.'});
 rows.forEach((r,i)=>{if(r.length!==headers.length)errors.push({line:lines[i],message:`A linha tem ${r.length} colunas; o cabeçalho tem ${headers.length}.`});});
 const first=headers.findIndex(h=>key(h)==='firstname'),last=headers.findIndex(h=>key(h)==='lastname');
 if(first>=0&&last>=0&&!headers.some(h=>['nome','fullname','nomecompleto'].includes(key(h)))){for(const r of rows)r.unshift([r[first],r[last]].filter(Boolean).join(' '));headers.unshift('Nome');}
 return {headers,rows,errors,lines};
}
export function parseManualContacts(text:string):ImportPreview{
 const nonempty=text.split(/\r?\n/).map((s,i)=>({text:s.trim(),line:i+1})).filter(s=>s.text);
 if(!nonempty.length)return {headers:Object.keys(importFields),rows:[],errors:[]};
 const csv=parseContactImport(text),auto=autoMapImport(csv.headers);if(auto.name!==undefined&&Object.keys(auto).length>1)return csv;
 const headers=Object.keys(importFields) as ImportField[],rows:string[][]=[],errors:ImportPreview['errors']=[];
 for(const entry of nonempty){const values:Partial<Record<ImportField,string>>={};const parts=entry.text.includes('|')?entry.text.split('|'):parseContactImport('a\n'+entry.text).rows[0]??[entry.text];
  for(const raw of parts){const value=raw.trim();if(!value)continue;const eq=value.indexOf('=');
   if(eq>0){const mapped=autoMapImport([value.slice(0,eq)]),field=Object.keys(mapped)[0] as ImportField|undefined;if(field)values[field]=value.slice(eq+1).trim();else errors.push({line:entry.line,message:`Campo não reconhecido: ${value.slice(0,eq)}.`});}
   else if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))values.email=value;
   else if(/^\+?[\d().\s-]{7,}$/.test(value))values.phone??=value;
   else if(/^(https?:\/\/|www\.)/i.test(value)||/^[\w-]+\.[a-z]{2,}(?:\/.*)?$/i.test(value))values.site=value;
   else if(!values.name)values.name=value;else values.name+=' '+value;
  }rows.push(headers.map(h=>values[h]??''));
 }return {headers,rows,errors,lines:nonempty.map(e=>e.line)};
}
export async function readImportFile(file:Pick<File,'arrayBuffer'>):Promise<string>{
 const bytes=new Uint8Array(await file.arrayBuffer());if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le').decode(bytes);if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be').decode(bytes);
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('windows-1252').decode(bytes);}
}
export function mapImportedContacts(preview:ImportPreview,mapping:ImportMapping,listId:string,custom:Record<string,number>={}){
 const leads:Lead[]=[],errors=[...preview.errors],selected=[...Object.values(mapping),...Object.values(custom)].filter(n=>n!==undefined&&n>=0);
 if(Object.keys(custom).length>30||Object.keys(custom).some(k=>!k.trim()||k.length>100||['__proto__','prototype','constructor'].includes(k))){errors.push({line:1,message:'Use até30 campos personalizados com nomes válidos de até100 caracteres.'});return {leads,errors};}
 if(selected.some(n=>!Number.isInteger(n)||n>=preview.headers.length)||new Set(selected).size!==selected.length){errors.push({line:1,message:'Use cada coluna uma única vez e revise o mapeamento.'});return {leads,errors};}
 preview.rows.forEach((row,i)=>{
  const line=preview.lines?.[i]??i+2,get=(field:ImportField)=>{const n=mapping[field];return n===undefined||n<0?undefined:row[n]?.trim()||undefined;},name=[get('name'),get('lastName')].filter(Boolean).join(' ');
  if(!name){errors.push({line,message:'Nome obrigatório.'});return;}
  const lead:Lead={id:crypto.randomUUID(),listId,name,source:'MANUAL',qualification:'pending',createdAt:new Date().toISOString()};
  for(const field of Object.keys(importFields) as ImportField[]){if(field==='name'||field==='lastName')continue;let value=get(field);if(!value)continue;
   if(field==='email')value=value.toLowerCase();if(field==='phone'||field==='whatsapp')value=value.replace(/[^\d+]/g,'');if(field==='cnpj')value=value.replace(/[.\/\s-]/g,'').toUpperCase();if(field==='state')value=value.toUpperCase();
   if(field==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)||['phone','whatsapp'].includes(field)&&!/^\+?\d{7,15}$/.test(value)||field==='cnpj'&&!/^[A-Z0-9]{12}\d{2}$/.test(value)){errors.push({line,message:`${importFields[field]} inválido.`});return;}
   if(value.length>(field==='summary'?20000:field==='site'?2000:field==='email'?254:field==='city'?200:field==='state'?50:field==='phone'||field==='whatsapp'?80:2000)){errors.push({line,message:`${importFields[field]} excede o tamanho permitido.`});return;}
   Object.assign(lead,{[field]:value});
  }if(name.length>250){errors.push({line,message:'Nome excede250 caracteres.'});return;}
  const values=Object.entries(custom).filter(([,n])=>n>=0).map(([k,n])=>[k,row[n]?.trim()??'']);if(values.some(([,v])=>v.length>2000)){errors.push({line,message:'Campo personalizado excede2.000 caracteres.'});return;}if(values.length)lead.customFields=Object.fromEntries(values);leads.push(lead);
 });return {leads,errors};
}
function identities(lead:Lead){
 const keys=['id:'+lead.id];if(lead.email)keys.push('email:'+lead.email.trim().toLowerCase());if(lead.cnpj)keys.push('cnpj:'+lead.cnpj.replace(/[.\/\s-]/g,'').toUpperCase());if(lead.phone){const phone=lead.phone.replace(/\D/g,'');if(phone)keys.push('phone:'+phone);}return keys;
}
export function deduplicateImports(rows:Lead[],existing:Lead[],scope:'list'|'workspace'='workspace'){
 const known=new Set<string>(),leads:Lead[]=[],duplicates:Lead[]=[],scoped=(lead:Lead)=>identities(lead).map(k=>scope==='list'&&!k.startsWith('id:')?lead.listId+':'+k:k);
 for(const lead of existing)for(const id of scoped(lead))known.add(id);
 for(const lead of rows){const ids=scoped(lead);if(ids.some(id=>known.has(id)))duplicates.push(lead);else{leads.push(lead);for(const id of ids)known.add(id);}}return {leads,duplicates};
}
