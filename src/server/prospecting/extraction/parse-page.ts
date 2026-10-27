import {parse} from 'parse5';
import {extractContacts,extractCnpjs} from './contacts.ts';
import {socialField} from '../../../domain/company-research.ts';
export const isContactLink=(url:string)=>/contato|contact|fale[-_/]?conosco|sobre|about|quem[-_/]?somos/i.test(new URL(url).pathname);
export function parsePage(html:string,base:string){
  const root=parse(html),text:string[]=[],attributes:string[]=[],links=new Set<string>(),socialLinks=new Set<string>(),externalLinks=new Set<string>();
  function visit(node:any){
    if(['script','style','noscript','template','svg','head','iframe','object'].includes(node.tagName))return;
    if(node.nodeName==='#text')text.push(node.value);
    if(node.tagName==='a'){
      const href=node.attrs?.find((a:any)=>a.name==='href')?.value;
      if(href)try{const u=new URL(href,base);if(u.protocol==='mailto:')attributes.push(decodeURIComponent(u.pathname).slice(0,254));if(u.protocol==='tel:')attributes.push(decodeURIComponent(u.pathname).slice(0,40));if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password){u.hash='';if(u.hostname===new URL(base).hostname)links.add(u.toString());else{externalLinks.add(u.toString());if(socialField(u.toString()))socialLinks.add(u.toString());}}}catch{}
    }
    for(const child of node.childNodes??[])visit(child);
  }visit(root);
  const visible=text.join(' ').replace(/\s+/g,' ').trim();
  const evidence=[{id:'parsed',url:base,fetchedAt:'',text:visible+' '+attributes.join(' '),hash:'',truncated:false}];
  const contacts=extractContacts(evidence),facts=[...contacts.emails,...contacts.phones,...extractCnpjs(evidence)].join(' ');
  return{text:visible,contactText:facts,links:[...links].sort((a,b)=>Number(isContactLink(b))-Number(isContactLink(a))).slice(0,50),socialLinks:[...socialLinks].slice(0,10),externalLinks:[...externalLinks].slice(0,50)};
}
