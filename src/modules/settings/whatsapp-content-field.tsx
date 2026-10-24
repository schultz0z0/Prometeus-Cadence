"use client";
import type {OutboundContent,TemplateView} from '@/domain/whatsapp';
import {Field,Notice} from '@/components/ui/primitives';
import type {WhatsappCapabilities} from '@/domain/whatsapp-capabilities';
export function WhatsappContentField({content,templates,onChange,allowText=true,capabilities}:{content:OutboundContent;templates:TemplateView[];onChange:(v:OutboundContent)=>void;allowText?:boolean;capabilities?:WhatsappCapabilities}){
 const current=content.kind==='template'?templates.find(t=>t.id===content.templateId):null;
 return <div className="stack"><Field label="Conteúdo da mensagem"><select value={content.kind==='text'?'text':content.templateId} onChange={e=>{const t=templates.find(t=>t.id===e.target.value);onChange(t?{kind:'template',templateId:t.id,templateRevision:t.revision,variables:{}}:{kind:'text',text:''});}}>
 <option value="text" disabled={!allowText||capabilities?.supportsText===false}>{capabilities?.requiresServiceWindow===false?'Texto · número próprio OpenWA':'Texto livre · exige janela de atendimento aberta'}</option>
 {capabilities?.supportsOfficialTemplates!==false&&templates.filter(t=>t.status==='approved').map(t=><option key={t.id} value={t.id}>{t.name} · {t.language} · revisão {t.revision}</option>)}
 </select></Field>
 {content.kind==='text'?<Field label="Mensagem"><textarea rows={4} maxLength={4096} value={content.text} onChange={e=>onChange({kind:'text',text:e.target.value})}/></Field>:current?<>
 <div className="message-preview">{current.components.map((c,i)=><p key={i}>{c.text}</p>)}</div>
 {current.parameters.map((p,i)=>{const key=p.key;return <Field key={key+i} label={`Variável ${key}`} help={p.type!=='text'?'Este parâmetro ainda não é suportado para envio.':undefined}><input disabled={p.type!=='text'} value={content.variables[key]??''} maxLength={1024} onChange={e=>onChange({...content,variables:{...content.variables,[key]:e.target.value}})}/></Field>;})}
 </>:<Notice>Sincronize os templates e selecione uma versão aprovada.</Notice>}
 </div>;
}
