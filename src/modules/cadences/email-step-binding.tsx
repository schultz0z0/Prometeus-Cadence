'use client';
import type {CadenceStep} from '@/domain/model';
import type {MailContent} from '@/domain/mail';
import {Field,Notice} from '@/components/ui/primitives';
export function EmailStepBinding({step,content,onChange}:{step:CadenceStep;content:MailContent;onChange:(content:MailContent)=>void}){
 const authored=!!step.variantB||!!step.attachmentIds?.length;
 return <div className="stack"><Field label="Assunto do e-mail"><input readOnly={authored} required maxLength={200} value={content.subject} onChange={e=>onChange({...content,subject:e.target.value})}/></Field><Field label="Texto do e-mail"><textarea readOnly={authored} required rows={4} value={content.text} onChange={e=>onChange({...content,text:e.target.value})}/></Field><Field label="Assinatura da caixa selecionada"><textarea readOnly rows={2} value={content.signature}/></Field>{authored&&<small>Edite as versões e os anexos no editor da etapa; a revisão usa o conteúdo salvo.</small>}<Notice>A revisão mostrará o endereço, a assinatura e o link de descadastro de cada destinatário. A etapa aguarda {step.delayDays} dias a partir da aceitação da anterior.</Notice></div>;
}
