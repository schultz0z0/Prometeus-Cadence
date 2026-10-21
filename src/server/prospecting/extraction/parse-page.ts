import {parse} from 'parse5';
import {extractContacts,extractCnpjs} from './contacts.ts';
export const isContactLink=(url:string)=>/contato|contact|fale[-_/]?conosco|sobre|about|quem[-_/]?somos/i.test(new URL(url).pathname);
export function parsePage(html:string,base:string){
  const root=parse(html),text:string[]=[],attributes:string[]=[],links=new Set<string>();
  function visit(node:any){
    if(['script','style','noscript','template','svg','head','iframe','object'].includes(node.tagName))return;
    if(node.nodeName==='#text')text.push(node.value);
    if(node.tagName==='a'){
      const href=node.attrs?.find((a:any)=>a.name==='href')?.value;
      if(href)try{const u=new URL(href,base);if(u.protocol==='mailto:')attributes.push(decodeURIComponent(u.pathname).slice(0,254));if(u.protocol==='tel:')attributes.push(decodeURIComponent(u.pathname).slice(0,40));if(['https:','http:'].includes(u.protocol)&&u.hostname===new URL(base).hostname&&!u.username&&!u.password){u.hash='';links.add(u.toString());}}catch{}
    }
    for(const child of node.childNodes??[])visit(child);
  }visit(root);
  const visible=text.join(' ').replace(/\s+/g,' ').trim();
  const evidence=[{id:'parsed',url:base,fetchedAt:'',text:visible+' '+attributes.join(' '),hash:'',truncated:false}];
  const contacts=extractContacts(evidence),facts=[...contacts.emails,...contacts.phones,...extractCnpjs(evidence)].join(' ');
  return{text:visible,contactText:facts,links:[...links].sort((a,b)=>Number(isContactLink(b))-Number(isContactLink(a))).slice(0,50)};
}
