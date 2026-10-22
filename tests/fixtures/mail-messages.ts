import type {MailSend} from '../../src/domain/mail.ts';
export const outgoing:MailSend={connectionId:'c',connectionRevision:1,senderId:'s',address:'sender@example.org',to:'contact@example.net',content:{kind:'email',subject:'Olá contato',text:'Podemos conversar?',signature:'Equipe'},rfcMessageId:'<d47c98f1-0e58-4e94-ae59-9e543631e117@cadence.example.org>',thread:null,purpose:'test',unsubscribeUrl:null};
export const source={remoteId:'remote:1',remoteThreadId:null,receivedAt:'2026-10-21T12:00:00Z',direction:'inbound' as const};
export function* rawMail(text:string){yield Buffer.from('From: sender@example.org\r\nTo: contact@example.net\r\nSubject: Test\r\nMessage-ID: <known@example.org>\r\n'+text);}
export function attachments(count:number){
 let value='Content-Type: multipart/mixed; boundary="qa"\r\n\r\n--qa\r\nContent-Type: text/plain\r\n\r\nHi\r\n';
 for(let i=0;i<count;i++)value+='--qa\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="'+i+'.txt"\r\n\r\nbytes\r\n';
 return value+'--qa--\r\n';
}
