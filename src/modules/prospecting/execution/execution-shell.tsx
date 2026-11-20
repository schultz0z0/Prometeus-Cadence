"use client";
import type {ReactNode} from 'react';
// 20/11/2026: the frame every end-user execution screen shares — title, one-line state, stages, link to the technical view.
export function ExecutionShell({title,status,technicalHref,actions,children}:{title:string;status:string;technicalHref?:string|null;actions?:ReactNode;children:ReactNode}){
 return <section className="execution-shell">
  <div className="execution-top"><div><h1>{title}</h1><p className="execution-status">{status}</p></div>
   <div className="execution-top-actions">{actions}{technicalHref&&<a className="execution-tech" href={technicalHref}>Detalhes técnicos</a>}</div></div>
  {children}
 </section>;
}
export function StageLine({stages,current}:{stages:{key:string;label:string}[];current:string|null}){
 const at=stages.findIndex(s=>s.key===current);
 return <ol className="execution-stages" aria-label="Etapas">{stages.map((s,i)=><li key={s.key} className={at<0?undefined:i<at?'done':i===at?'current':undefined} aria-current={i===at?'step':undefined}>{s.label}</li>)}</ol>;
}
