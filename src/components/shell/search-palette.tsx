"use client";
import {useRouter} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import type {SearchHit} from '@/domain/assistant-actions';
import {searchWorkspace} from '@/client/assistant-client';
import {navigation} from './navigation';
import {Icon} from '../ui/icon';
type Row={key:string;label:string;detail:string;href:string;icon:string;group:string};
const groups:Record<SearchHit['kind'],[string,string]>={lead:['Leads','Building2'],cadence:['Cadências','Send'],list:['Listas','Users']};
// Pages carry their menu section, so same-named pages (Cadências, Templates) stay distinguishable.
const pages=navigation.flatMap(n=>n.children?.map(c=>({...c,section:n.label}))??[{label:n.label,href:n.href!,icon:n.icon,section:'Menu'}]);
const norm=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
export function SearchPalette({onClose,workspaceId}:{onClose:()=>void;workspaceId:string|null}){
 const router=useRouter(),ref=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
 const [q,setQ]=useState(''),[hits,setHits]=useState<SearchHit[]>([]),[cursor,setCursor]=useState<string|null>(null),[state,setState]=useState<'idle'|'loading'|'error'>('idle'),[active,setActive]=useState(0);
 useEffect(()=>{const d=ref.current,trigger=document.activeElement as HTMLElement|null;d?.showModal();input.current?.focus();return ()=>{d?.close();trigger?.focus();};},[]);
 const term=q.trim();
 useEffect(()=>{
  setHits([]);setCursor(null);setActive(0);
  if(!workspaceId||term.length<2){setState('idle');return;}
  // Each keystroke cancels the previous request, so a slow old answer never replaces a newer one.
  const controller=new AbortController(),timer=setTimeout(()=>{setState('loading');searchWorkspace(workspaceId,term,controller.signal).then(r=>{setHits(r.items);setCursor(r.nextCursor);setState('idle');}).catch(()=>{if(!controller.signal.aborted)setState('error');});},200);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[term,workspaceId]);
 async function more(){if(!workspaceId||!cursor)return;setState('loading');try{const r=await searchWorkspace(workspaceId,term,new AbortController().signal,cursor);setHits(h=>[...h,...r.items]);setCursor(r.nextCursor);setState('idle');}catch{setState('error');}}
 const pageRows:Row[]=term?pages.filter(p=>norm(p.label+' '+p.section).includes(norm(term))).map(p=>({key:'page:'+p.href,label:p.label,detail:p.section,href:p.href,icon:p.icon,group:'Páginas'})):[];
 const rows:Row[]=[...hits.map(h=>({key:h.kind+':'+h.id,label:h.label,detail:h.detail,href:h.href,icon:groups[h.kind][1],group:groups[h.kind][0]})),...pageRows];
 function open(row:Row|undefined){if(!row)return;router.push(row.href);onClose();}
 return <dialog ref={ref} className="search-palette" aria-label="Buscar" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current)onClose();}}>
  <div className="search-palette-input"><Icon name="Search" size={16}/>
   <input ref={input} value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar lead, cadência ou página..." aria-label="Buscar lead, cadência ou página" role="combobox" aria-expanded={rows.length>0} aria-controls="search-palette-results" aria-activedescendant={rows[active]?'search-row-'+active:undefined}
    onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setActive(a=>Math.min(a+1,rows.length-1));}else if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(a-1,0));}else if(e.key==='Enter'){e.preventDefault();open(rows[active]);}}}/>
   <button type="button" className="icon-btn" aria-label="Fechar busca" onClick={onClose}><Icon name="X" size={15}/></button></div>
  <div className="search-palette-body" id="search-palette-results" role="listbox" aria-label="Resultados">
   {!term&&<p className="search-palette-hint">Digite um nome, e-mail, telefone ou o nome de uma cadência ou tela.</p>}
   {rows.map((r,i)=><div key={r.key}>{(i===0||rows[i-1].group!==r.group)&&<h4>{r.group}</h4>}
    <a id={'search-row-'+i} role="option" aria-selected={i===active} href={r.href} className={i===active?'active':''} onMouseEnter={()=>setActive(i)} onClick={e=>{e.preventDefault();open(r);}}>
     <Icon name={r.icon} size={15}/><span><strong>{r.label}</strong>{r.detail&&<small>{r.detail}</small>}</span><Icon name="CornerDownLeft" size={13}/></a></div>)}
   {cursor&&<button type="button" className="search-palette-more" onClick={()=>void more()} disabled={state==='loading'}>Mostrar mais resultados</button>}
   {term&&state==='loading'&&!hits.length&&<p className="search-palette-hint" role="status">Buscando…</p>}
   {term&&state==='error'&&<p className="search-palette-hint" role="alert">Não foi possível buscar agora. As páginas continuam disponíveis.</p>}
   {term.length===1&&workspaceId&&!pageRows.length&&<p className="search-palette-hint">Digite ao menos 2 caracteres.</p>}
   {term.length>=2&&state==='idle'&&!rows.length&&<p className="search-palette-hint">Nada encontrado para “{term}”.</p>}
  </div>
  <footer><span><kbd>↑↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> fechar</span></footer>
 </dialog>;
}
