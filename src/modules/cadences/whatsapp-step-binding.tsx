"use client";
import type {CadenceStep} from '@/domain/model';
import type {OutboundContent,TemplateView} from '@/domain/whatsapp';
import {Notice} from '@/components/ui/primitives';
import {WhatsappContentField} from '@/modules/settings/whatsapp-content-field';
export function WhatsappStepBinding({step,index,content,templates,onChange}:{step:CadenceStep;index:number;content:OutboundContent;templates:TemplateView[];onChange:(v:OutboundContent)=>void}){
 return <section className="stack section-gap"><h3>Etapa {index+1} · espera de {step.delayDays} dias</h3>{step.channel!=='WHATSAPP'?<Notice tone="error">O canal {step.channel} ainda não pode ser publicado neste marco.</Notice>:<><p className="muted">O modelo de escrita do rascunho não é um template aprovado pela Meta. Vincule abaixo o conteúdo que será publicado. Variáveis aceitam os campos do lead, como {'{{nome}}'}.</p><WhatsappContentField content={content} templates={templates} onChange={onChange}/></>}</section>;
}
