import {randomUUID} from 'node:crypto';
import {whatsappUser,testAdmin} from './whatsapp-helpers.ts';
export {testAdmin};
export const mailUser=whatsappUser;
export function smtpMailboxInput(){return {requestId:randomUUID(),expectedRevision:0,provider:'smtp-imap' as const,name:'QA Mail',address:'Sales+qa@example.org',signature:'Equipe QA',config:{smtpHost:'smtp.example.org',smtpPort:465 as const,imapHost:'imap.example.org',imapPort:993 as const,smtpUser:'user',imapUser:'user',inbox:'INBOX',sentFolder:null},credentials:{smtpPassword:'fixture-smtp-password',imapPassword:'fixture-imap-password'}};}
