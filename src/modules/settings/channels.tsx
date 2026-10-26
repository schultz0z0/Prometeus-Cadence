"use client";
import {WhatsappSettings} from './whatsapp-settings';
import {EmailSettings} from './email-settings';
import {Icon} from '@/components/ui/icon';
export function Channels({section}:{section:string}){
 if(section==='whatsapp')return <WhatsappSettings/>;
 if(section==='dispatch-limits')return <div className="dispatch-reference"><h1>Limites de disparo</h1><p className="subtitle">Quantas mensagens cada caixa ou número pode enviar por dia. Defina um ritmo adequado à sua operação.</p><section className="dispatch-channel" aria-label="Limites de e-mail"><header><Icon name="Mail"/><div><h2>E-mail</h2><p>O limite por caixa vale para todas as cadências, testes e respostas. O teto do workspace continua valendo.</p></div></header><div className="dispatch-channel-body"><EmailSettings limitsOnly/></div></section><section className="dispatch-channel" aria-label="Limites de WhatsApp"><header><Icon name="MessageCircle"/><div><h2>WhatsApp</h2><p>OpenWA: até 20 mensagens e 5 novos contatos autorizados por dia. A conexão oficial também respeita os limites da Meta.</p></div></header><div className="dispatch-channel-body"><WhatsappSettings limitsOnly/></div></section></div>;
 return <EmailSettings/>;
}
