import type {MailMessage} from '../../domain/mail.ts';
export interface ThreadCandidate {id:string;rfcMessageId:string|null;remoteThreadId:string|null;contact:string;subject:string}
export function matchMailThread(message:MailMessage,candidates:ThreadCandidate[]):{kind:'matched';id:string}|{kind:'new'}|{kind:'ambiguous'} {
 const refs=new Set([message.inReplyTo,...message.references].filter(Boolean));
 const matches=candidates.filter(c=>(c.rfcMessageId&&refs.has(c.rfcMessageId))||(message.remoteThreadId&&c.remoteThreadId===message.remoteThreadId));
 if(!matches.length)return {kind:'new'};
 if(matches.some(c=>c.contact!==message.from))return {kind:'ambiguous'};
 const ids=[...new Set(matches.map(c=>c.id))];return ids.length===1?{kind:'matched',id:ids[0]}:{kind:'ambiguous'};
}
