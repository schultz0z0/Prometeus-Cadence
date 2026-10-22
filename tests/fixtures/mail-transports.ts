import nodemailer from 'nodemailer';import {ImapFlow} from 'imapflow';
import {mailTestTls,smtpFixture} from './smtp-server.ts';import {imapFixture} from './imap-server.ts';
import type {SmtpImapDeps} from '../../src/server/mail/providers/smtp-imap.ts';
import type {MailConfig} from '../../src/server/mail/contracts.ts';
export const smtpConfig:MailConfig={mailbox:{id:'c',senderId:'s',provider:'smtp-imap',name:'Fixture',address:'sender@example.org',revision:1,state:'verifying',hasSecrets:true,sendVerified:false,readVerified:false,lastSyncedAt:null,syncState:'baseline',dailyLimit:1,signature:'Equipe',lastError:null},config:{smtpHost:'smtp.example.org',smtpPort:465,imapHost:'imap.example.org',imapPort:993,smtpUser:'user',imapUser:'user',inbox:'INBOX',sentFolder:null},credentials:{smtpPassword:'fixture-smtp-password',imapPassword:'fixture-imap-password'},cursor:null};
export async function mailTransports(secure=true,noStartTls=false){
 const smtp=await smtpFixture({secure,noStartTls}),imap=await imapFixture(),seen:{host:string;servername:string}[]=[];
 const deps:SmtpImapDeps={network:{resolve:async()=>[{address:'93.184.216.34',family:4}]},
  smtpTransport:options=>{seen.push({host:String(options.host),servername:String(options.tls?.servername)});return nodemailer.createTransport({...options,host:'127.0.0.1',port:smtp.port,tls:{...options.tls,ca:mailTestTls.cert}});},
  imapClient:options=>{seen.push({host:String(options.host),servername:String(options.servername)});return new ImapFlow({...options,host:'127.0.0.1',port:imap.port,tls:{...options.tls,ca:mailTestTls.cert}});},
 };return {smtp,imap,deps,seen,close:async()=>{await smtp.close();await imap.close();}};
}
