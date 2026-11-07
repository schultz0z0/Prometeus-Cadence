"use client";
import {useState} from 'react';
import {usePathname} from 'next/navigation';
import {helpArticles,matchHelp} from '@/domain/help-manifest';
import Link from 'next/link';
import {Modal} from '../ui/primitives';
import {Icon} from '../ui/icon';
const norm=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
export function HelpCenter({onClose,contextual=false}:{onClose:()=>void;contextual?:boolean}){
 const path=usePathname(),[q,setQ]=useState('');
 // Articles for the current area come first; typing narrows by title and text.
 const here=matchHelp('',path),term=norm(q.trim()),list=[...here,...helpArticles.filter(a=>!here.includes(a))].filter(a=>!term||norm(a.title+' '+a.body).includes(term));
 return <Modal title={contextual?'Ajuda':'Central de Ajuda'} description={contextual?'Passeios e guias desta tela, sem sair de onde você está.':'Passo a passo de cada área do Prometeus.'} onClose={onClose} className={contextual?'help-center contextual-help':'help-center'}>
  {contextual&&<Link className="btn compact" href="/aprender" onClick={onClose}><Icon name="BookOpen" size={15}/>Ver trilhas em Aprender</Link>}
  <div className="search-input"><Icon name="Search" size={15}/><input data-autofocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar na ajuda..." aria-label="Buscar na ajuda"/></div>
  <div className="help-center-list">{list.map(a=><details key={a.id} open={here[0]?.id===a.id&&!q}><summary>{a.title}</summary><p>{a.body}</p><Link className="btn compact" href={a.href} onClick={onClose}>Ir para a área<Icon name="ArrowRight" size={14}/></Link></details>)}
   {!list.length&&<p className="muted">Nenhum artigo encontrado. Pergunte ao assistente ou fale com a gente.</p>}</div>
 </Modal>;
}
