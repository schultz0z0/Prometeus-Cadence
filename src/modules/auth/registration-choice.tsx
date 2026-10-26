"use client";
import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
export type RegistrationIntent={plan:"essential"|"pro";mode:"trial"|"subscribe"};
export function RegistrationChoice({value,onChange,onContinue}: {value:RegistrationIntent;onChange:(v:RegistrationIntent)=>void;onContinue:()=>void}) {
  return <div className="registration-choice"><small>COMO QUER COMEÇAR</small><div className="registration-choice-grid">{([['trial','Teste grátis','7 dias, sem cartão e sem cobrança automática','Sparkles'],['subscribe','Assinar agora','Plano completo após contratar','CreditCard']] as const).map(([mode,title,detail,icon])=><button key={mode} type="button" aria-pressed={value.mode===mode} onClick={()=>onChange({mode,plan:mode==='trial'?'essential':value.plan})}><span><Icon name={icon} size={16}/></span><div><strong>{title}</strong><p>{detail}</p></div></button>)}</div>
  <small>PLANO</small><div className="registration-choice-grid registration-plans">{(['essential','pro'] as const).map(plan=><button type="button" key={plan} disabled={value.mode==='trial'&&plan==='pro'} aria-pressed={value.plan===plan} onClick={()=>onChange({...value,plan})}><strong>{plan==='pro'?'Pro':'Essential'}</strong>{value.plan===plan&&<Icon name="CheckCircle2" size={16}/>}<div><b>{plan==='pro'?'R$ 897,00':'R$ 397,00'}</b> /mês</div><p>{value.mode==='trial'?(plan==='pro'?'Disponível com assinatura':'Contratação opcional após o teste'):'Cobrança após confirmar a contratação'}</p></button>)}</div>
  <div className="registration-choice-note"><Icon name="CheckCircle2" size={16}/><p>{value.mode==='trial'?<><strong>Sem cobrança hoje.</strong> Teste o Essential por 7 dias. Para continuar depois, escolha uma assinatura.</>:<>Você revisará a contratação após criar e verificar sua conta. Nenhuma cobrança é feita nesta etapa.</>}</p></div>
  <Button variant="primary" onClick={onContinue}>Continuar <Icon name="ArrowRight" size={16}/></Button><p className="auth-bottom">Já tem conta? <Link href="/login">Fazer login</Link></p></div>;
}
