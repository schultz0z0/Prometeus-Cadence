"use client";
import {EmptyState,LinkButton} from '@/components/ui/primitives';
import {WhatsappInbox} from './whatsapp-inbox';
export function Inbox({whatsapp=false}:{whatsapp?:boolean}){
 if(whatsapp)return <WhatsappInbox/>;
 return <><h1>E-mail</h1><EmptyState icon="Mail" title="Inbox de e-mail em preparação" description="Envio e recebimento de e-mail fazem parte do marco 05B."><LinkButton href="/messages/whatsapp">Abrir inbox WhatsApp</LinkButton></EmptyState></>;
}
