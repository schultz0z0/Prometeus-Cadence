import type {PlanningEvidence} from '@/domain/planning';
export function SourceList({sources}:{sources:PlanningEvidence[]}){
 return <details className="section-gap"><summary>Fontes consultadas ({sources.length})</summary><div className="stack section-gap">{sources.map(s=><article key={s.id}>
  {s.url?<a href={s.url} target="_blank" rel="noreferrer">{s.url}</a>:<strong>{s.kind==='approved_context'?'Contexto aprovado':s.kind==='lead_fact'?'Dados do lead':'Brief informado'}</strong>}
  <small> · {new Date(s.obtainedAt).toLocaleString('pt-BR')}</small><details><summary>Ver trecho</summary><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{s.text}</p></details>
 </article>)}</div></details>;
}
