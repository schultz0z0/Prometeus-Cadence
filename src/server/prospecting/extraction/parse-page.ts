import {parse} from 'parse5';
export function parsePage(html:string,base:string){
  const root=parse(html),text:string[]=[],links=new Set<string>();
  function visit(node:any){
    if(['script','style','noscript','template','svg','head','iframe','object'].includes(node.tagName))return;
    if(node.nodeName==='#text')text.push(node.value);
    if(node.tagName==='a'){
      const href=node.attrs?.find((a:any)=>a.name==='href')?.value;
      if(href)try{const u=new URL(href,base);if(['https:','http:'].includes(u.protocol)&&u.hostname===new URL(base).hostname&&!u.username&&!u.password){u.hash='';links.add(u.toString());}}catch{}
    }
    for(const child of node.childNodes??[])visit(child);
  }visit(root);
  return{text:text.join(' ').replace(/\s+/g,' ').trim(),links:[...links].slice(0,50)};
}
