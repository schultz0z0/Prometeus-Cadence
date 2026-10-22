"use client";
import {WhatsappSettings} from './whatsapp-settings';
import {EmailSettings} from './email-settings';
export function Channels({section}:{section:string}){
 if(section==='whatsapp')return <WhatsappSettings/>;
 if(section==='dispatch-limits')return <><WhatsappSettings limitsOnly/><div className="section-gap"><EmailSettings limitsOnly/></div></>;
 return <EmailSettings/>;
}
