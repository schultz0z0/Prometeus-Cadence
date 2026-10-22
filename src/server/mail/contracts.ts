import type {MailboxView,SyncCursor} from '../../domain/mail.ts';
export interface SmtpImapConfig {smtpHost:string;smtpPort:465|587;imapHost:string;imapPort:993;smtpUser:string;imapUser:string;inbox:string;sentFolder:string|null}
export interface MailConfig {mailbox:MailboxView;config:SmtpImapConfig|Record<string,never>;credentials:Record<string,string>;cursor:SyncCursor|null}
