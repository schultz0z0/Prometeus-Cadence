"use client";
import { useState } from "react";
import { useDemo } from "@/demo/provider";
import type { CadenceStep,Channel } from "@/domain/model";
import { renderStepPreview } from "@/domain/cadence";
import { useIdentity } from "@/client/workspace-provider";
import { MessagePreview } from "@/modules/planning/message-preview";
import { Icon } from "@/components/ui/icon";
import { Button,Field,Modal,Toggle,Notice } from "@/components/ui/primitives";
import { TokenMessageEditor } from "./token-message-editor";
export function StepEditor({step,index,total,listId,cadenceId,pending=false,onSave,onDelete,onMove,onNavigate,onClose}: {
 step:CadenceStep;index:number;total:number;listId:string;cadenceId?:string;pending?:boolean;
 onSave:(s:CadenceStep)=>void;onDelete:()=>void;onMove:(direction:-1|1,edited:CadenceStep)=>void;onNavigate?:(index:number,edited:CadenceStep)=>void;onClose:()=>void;
}){
 const s=useDemo(),identity=useIdentity(),[d,setD]=useState(structuredClone(step));
 const leads=s.leads.filter(l=>l.listId===listId),[leadId,setLeadId]=useState(leads[0]?.id??''),lead=leads.find(l=>l.id===leadId),preview=lead?renderStepPreview(d,lead):null;
 const [templates,setTemplates]=useState(false),[messageError,setMessageError]=useState(false);
 return <Modal wide className="step-reference-drawer" title={'Etapa '+(index+1)+' de '+(pending?total+1:total)} description="O que sai neste passo. Clique em outra etapa no fluxo para trocar." onClose={onClose}>
 <form className="step-reference-form" onSubmit={e=>{e.preventDefault();if(!d.body.trim()){setMessageError(true);e.currentTarget.querySelector<HTMLElement>('.token-message-editor')?.focus();return;}onSave(d);}}><div className="step-reference-scroll"><div className="step-reference-content">
 <div className="step-reference-top"><span className="step-reference-number">{index+1}</span><Field label="Dia"><input type="number" aria-label="Dias de espera" min="0" required value={d.delayDays} onChange={e=>setD({...d,delayDays:Number(e.target.value)})}/></Field><div className="step-reference-channels" role="group" aria-label="Canal">{([['EMAIL','E-mail','Mail'],['WHATSAPP','WhatsApp','MessageSquare'],['LINKEDIN','LinkedIn','Linkedin']] as const).map(([channel,label,icon])=><Button type="button" key={channel} aria-pressed={d.channel===channel} className={d.channel===channel?'selected '+channel.toLowerCase():''} onClick={()=>setD({...d,channel:channel as Channel})}><Icon name={icon} size={14}/>{label}</Button>)}</div><div className="step-reference-tools"><Button type="button" icon="ChevronUp" aria-label="Mover etapa para cima" title="Mover etapa para cima" disabled={pending||index===0} onClick={()=>onMove(-1,d)}/><Button type="button" icon="ChevronDown" aria-label="Mover etapa para baixo" title="Mover etapa para baixo" disabled={pending||index===total-1} onClick={()=>onMove(1,d)}/><Button type="button" icon="Trash2" aria-label="Remover etapa" title="Remover etapa" onClick={onDelete}/></div></div>
 <Button type="button" className="step-reference-template" icon="FileText" onClick={()=>setTemplates(!templates)}>Usar Template</Button>
 {templates&&<Field label="Usar template"><select defaultValue="" onChange={e=>{const t=s.templates.find(t=>t.id===e.target.value);if(t)setD({...d,subject:t.subject,body:t.body});}}><option value="">Escolha um template</option>{s.templates.filter(t=>t.channel===d.channel).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>{!s.templates.some(t=>t.channel===d.channel)&&<small>Nenhum template salvo para este canal.</small>}</Field>}
 {d.channel==='EMAIL'&&<Field label="Assunto"><input value={d.subject??''} onChange={e=>setD({...d,subject:e.target.value})}/></Field>}
 <TokenMessageEditor value={d.body} invalid={messageError} onChange={body=>{setD({...d,body});setMessageError(false);}}/>
 <Button type="button" className="step-reference-variant" disabled title="Variações de mensagem ainda não disponíveis">+ Adicionar versão B · indisponível nesta entrega</Button>
 <Field label="Personalização com IA (opcional)"><textarea value={d.aiInstructions??''} onChange={e=>setD({...d,aiInstructions:e.target.value})} placeholder="Ex.: mencione o site do lead, mantenha o tom pessoal…"/></Field>
 {identity&&cadenceId&&!pending&&lead?<div className="step-reference-ai"><MessagePreview key={lead.id+step.id} cadenceId={cadenceId} step={d} lead={lead} onAccept={setD}/></div>:<Button type="button" disabled icon="Eye">Visualizar com IA · selecione um lead</Button>}
 <details className="step-reference-options"><summary>Opções desta etapa</summary><Toggle label="Sair se o lead responder" checked={d.stopOnReply} onChange={v=>setD({...d,stopOnReply:v})}/>{d.channel==='WHATSAPP'&&<Notice>O template aprovado e suas variáveis são vinculados na revisão de publicação.</Notice>}</details>
 <div className="step-reference-attachments"><div className="row between"><span><Icon name="Link2" size={16}/>Anexos</span><Button type="button" disabled>+ Anexar</Button></div><small>Anexos ainda não estão disponíveis para envio.</small></div>
 </div><aside className="step-reference-preview"><div className="row"><strong>COMO O LEAD VAI VER</strong><select aria-label="Lead para prévia" value={leadId} onChange={e=>setLeadId(e.target.value)}><option value="">Selecione um lead</option>{leads.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></div><div className={'step-reference-preview-bubble '+d.channel.toLowerCase()}>{d.channel==='EMAIL'&&preview?.subject&&<h4>{preview.subject}</h4>}<p>{preview?.text||'Selecione um lead da lista para conferir a mensagem.'}</p></div>{preview?.unresolved.length?<Notice>Variáveis sem valor: {preview.unresolved.join(', ')}. Revise antes de usar.</Notice>:null}</aside></div>
 <footer className="step-reference-footer"><div className="row"><Button type="button" disabled={pending||index===0||!onNavigate} onClick={()=>onNavigate?.(index-1,d)}>← Anterior</Button><Button type="button" disabled={pending||index>=total-1||!onNavigate} onClick={()=>onNavigate?.(index+1,d)}>Próxima →</Button></div><Button type="submit" variant="primary">Concluir</Button></footer></form></Modal>;
}
