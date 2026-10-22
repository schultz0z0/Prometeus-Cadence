import type {MailSend,SyncCursor,SyncBatch} from '../../../domain/mail.ts';
import type {SendOutcome} from '../../../domain/whatsapp.ts';
import type {Principal} from '../../../domain/workspace.ts';
import type {MailConfig} from '../contracts.ts';
import type {NetworkDeps} from '../network.ts';
export type {MailConfig} from '../contracts.ts';
export interface MailDeps {fetch?:typeof fetch;now?:()=>string;principal?:Principal;network?:NetworkDeps}
export interface MailAdapter {
 verify(config:MailConfig):Promise<{address:string;send:boolean;read:boolean}>;
 sendOnce(config:MailConfig,send:MailSend):Promise<SendOutcome>;
 readBatch(config:MailConfig,cursor:SyncCursor|null,budget:{maxMessages:number;maxPages:number}):Promise<SyncBatch>;
 findSent(config:MailConfig,send:MailSend):Promise<SendOutcome|null>;
}
