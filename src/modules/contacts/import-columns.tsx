"use client";
import {useState} from 'react';
import {importFields,type ImportMapping,type ImportField,type ImportPreview} from '@/domain/import';
import {Button,Field,Modal} from '@/components/ui/primitives';
import {Icon} from '@/components/ui/icon';
export function ImportColumns({preview,fileName,mapping,custom,onChange}:{preview:ImportPreview;fileName:string;mapping:ImportMapping;custom:Record<string,number>;onChange:(mapping:ImportMapping,custom:Record<string,number>)=>void}){
 const [creating,setCreating]=useState<number|null>(null),[name,setName]=useState(''),[error,setError]=useState('');
 function assign(index:number,value:string){
  if(value==='new-custom'){setCreating(index);setName('');setError('');return;}
  const next=Object.fromEntries(Object.entries(mapping).filter(([,n])=>n!==index)) as ImportMapping,nextCustom=Object.fromEntries(Object.entries(custom).filter(([,n])=>n!==index));
  if(value.startsWith('custom:'))nextCustom[value.slice(7)]=index;else if(value)next[value as ImportField]=index;
  onChange(next,nextCustom);
 }
 const count=Object.values(mapping).filter(n=>n!==undefined&&n>=0).length+Object.keys(custom).length;
 return <>
 <header className="import-mapping-head"><div><h2><Icon name="Columns3" size={15}/>Mapeamento de Colunas</h2><p>{fileName||'Dados colados'} · {preview.rows.length} linhas · {preview.headers.length} colunas detectadas</p></div><div className="row wrap"><span className="import-mapped-count"><Icon name="CircleCheck" size={14}/>{count} campos mapeados</span><span>{preview.headers.length-count} ignoradas</span></div></header>
 <div className="import-column-rows">{preview.headers.map((header,index)=>{
  const field=(Object.keys(mapping) as ImportField[]).find(k=>mapping[k]===index),extra=Object.keys(custom).find(k=>custom[k]===index),value=field??(extra?'custom:'+extra:'');
  return <div className={`import-mapping-row ${value?'mapped':''}`} key={index}><div><strong>{header||`Coluna ${index+1}`}</strong><small>{preview.rows[0]?.[index]||'Sem exemplo'}</small></div><Icon name="ArrowRight" size={15}/><select aria-label={`Mapear ${header||`coluna ${index+1}`}`} value={value} onChange={e=>assign(index,e.target.value)}><option value="">Ignorar coluna</option>{Object.entries(importFields).map(([key,label])=><option key={key} value={key}>{label}</option>)}{Object.keys(custom).map(key=><option key={'custom:'+key} value={'custom:'+key}>{key} (personalizado)</option>)}<option value="new-custom">+ Criar campo personalizado…</option></select><span className="import-mapping-check">{value&&<Icon name="CircleCheck" size={15}/>}</span></div>;
 })}</div>
 {creating!==null&&<Modal title="Criar campo personalizado" onClose={()=>setCreating(null)}><form className="stack" onSubmit={e=>{e.preventDefault();const label=name.trim();if(!label||label.length>100||['__proto__','prototype','constructor'].includes(label)||Object.hasOwn(custom,label)||Object.keys(custom).length>=30){setError('Informe um nome novo de até100 caracteres. Máximo de30 campos por contato.');return;}const next=Object.fromEntries(Object.entries(mapping).filter(([,n])=>n!==creating)) as ImportMapping;onChange(next,{...Object.fromEntries(Object.entries(custom).filter(([,n])=>n!==creating)),[label]:creating});setCreating(null);}}><Field label="Nome do campo"><input required autoFocus maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></Field>{error&&<p role="alert" className="error-bar">{error}</p>}<div className="form-actions"><Button type="button" onClick={()=>setCreating(null)}>Cancelar</Button><Button type="submit" variant="primary">Criar campo</Button></div></form></Modal>}
 </>;
}
