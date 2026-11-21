"use client";
import type {LotDot,GenerationDotGroup} from '@/domain/execution-overview';
type Dot={group:LotDot['group']|GenerationDotGroup;name:string};
// 20/11/2026: one dot per company of the run; finished dots take the color of their result.
const groupNames:Record<Dot['group'],string>={new:'nova na lista',dup:'já estava na sua base',out:'descartada',ready:'pronta para abordar',noInfo:'sem informação suficiente',outside:'fora do perfil',nothing:'sem nada a aplicar',pending:'aguardando',current:'em análise agora'};
export function LotMap({dots,label}:{dots:Dot[];label:string}){
 return <div className="lot-map" role="img" aria-label={label}>{dots.map((d,i)=><i key={i} className={'lot-dot '+d.group} title={(d.name?d.name+' — ':'')+groupNames[d.group]}/>)}</div>;
}
export function LotLegend({items}:{items:{group:Dot['group'];text:string}[]}){
 return <p className="lot-legend">{items.map(i=><span key={i.group} className={'lot-key '+i.group}>{i.text}</span>)}</p>;
}
