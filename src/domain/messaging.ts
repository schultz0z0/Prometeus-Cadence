import type {MailProvider,MailIdentity,MailSend} from './mail.ts';
import type {Provider,PreparedSend} from './whatsapp.ts';
import type {SenderView} from './whatsapp.ts';
export type MessagingProvider=Provider|MailProvider;
export type MessagingSenderView=Omit<SenderView,'provider'>&{provider:MessagingProvider;channel:'EMAIL'|'WHATSAPP'};
export type MessagingIdentity=MailIdentity|{channel:'WHATSAPP';scope:string;externalId:string;phone:string|null};
export type PreparedSendV2=({channel:'EMAIL'}&MailSend)|({channel:'WHATSAPP'}&PreparedSend);
export type {Review,DispatchLease,SendOutcome,Receipt,MessageState} from './whatsapp.ts';
