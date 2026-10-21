"use client";
import {EmptyState,Notice} from '@/components/ui/primitives';
import {WhatsappSettings} from './whatsapp-settings';
export function Channels({section}:{section:string}){
 if(section==='whatsapp'||section==='dispatch-limits')return <WhatsappSettings limitsOnly={section==='dispatch-limits'}/>;
 return <><h1>Contas de e-mail</h1><p className="subtitle">Envio e recebimento de e-mail pelas cadências.</p><EmptyState icon="Mail" title="Integração de e-mail em preparação" description="As conexões de e-mail serão disponibilizadas no marco 05B. Seus rascunhos de cadência permanecem editáveis."/><Notice>Este marco conecta WhatsApp pela API oficial da Meta ou pela Twilio.</Notice></>;
}
