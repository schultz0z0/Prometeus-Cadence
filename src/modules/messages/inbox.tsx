"use client";
import {WhatsappInbox} from './whatsapp-inbox';
import {EmailInbox} from './email-inbox';
export function Inbox({whatsapp=false,channel}:{whatsapp?:boolean;channel?:'EMAIL'|'WHATSAPP'}){
 return whatsapp||channel==='WHATSAPP'?<WhatsappInbox/>:<EmailInbox/>;
}
