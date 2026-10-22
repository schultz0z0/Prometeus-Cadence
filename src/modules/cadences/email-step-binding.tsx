'use client';
import type {CadenceStep} from '@/domain/model';
import type {MailContent} from '@/domain/mail';
import {Field,Notice} from '@/components/ui/primitives';
export function EmailStepBinding({step,content,onChange}:{step:CadenceStep;content:MailContent;onChange:(content:MailContent)=>void}){
 return <div className="stack"><Field label="Assunto do e-mail"><input required maxLength={200} value={content.subject} onChange={e=>onChange({...content,subject:e.target.value})}/></Field><Field label="Texto do e-mail"><textarea required rows={4} value={content.text} onChange={e=>onChange({...content,text:e.target.value})}/></Field><Field label="Assinatura da caixa selecionada"><textarea readOnly rows={2} value={content.signature}/></Field><Notice>A revisão mostrará o endereço, a assinatura e o link de descadastro de cada destinatário. A etapa aguarda {step.delayDays} dias a partir da aceitação da anterior.</Notice></div>;
}
