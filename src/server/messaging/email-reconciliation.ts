import 'server-only';
import type {Principal} from '../../domain/workspace.ts';
import type {MailSend} from '../../domain/mail.ts';
import type {ReconciliationSnapshot} from '../../domain/cadence-runtime.ts';
import type {MailDeps,MailAdapter} from '../mail/providers/contracts.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {readMailConfig} from '../mail/repository.ts';
import {withGmailAccess} from '../mail/oauth.ts';
import {createGmailAdapter} from '../mail/providers/gmail.ts';
import {createSmtpImapAdapter} from '../mail/providers/smtp-imap.ts';
import {createReviewToken} from '../prospecting/review.ts';
import {AppError} from '../errors.ts';
type Evidence={resolution:'accepted'|'not_accepted';remoteId:string|null;evidence:string;reference:string;proofKind:'provider-log';verifiedByUser:true};
export async function mailReconciliationState(p:Principal,ctx:Record<string,any>,messageId:string,input:Evidence,deps:MailDeps&{adapter?:MailAdapter}={}){
 if(ctx.outbox.prepared_send.channel!=='EMAIL')throw new AppError(422,'A mensagem não é de e-mail.');
 const config=await withWorkspaceTransaction(p,c=>readMailConfig(c,ctx.connection.id)),send=ctx.outbox.prepared_send as MailSend;
 if(config.mailbox.address!==send.address||config.mailbox.provider!==ctx.connection.provider)throw new AppError(409,'A conta da tentativa mudou.');
 const url=new URL(input.reference),host=config.mailbox.provider==='gmail'?'mail.google.com':('smtpHost'in config.config?config.config.smtpHost:'');
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hostname!==host)throw new AppError(422,'Use uma referência HTTPS dos logs da própria conta de e-mail.');
 if((input.resolution==='accepted'&&!input.remoteId)||(input.resolution==='not_accepted'&&input.remoteId))throw new AppError(422,'Revise o resultado e o identificador remoto.');
 let verification:ReconciliationSnapshot['verification']='administrator-evidence';
 if(input.resolution==='accepted'){
  const adapter=deps.adapter??(config.mailbox.provider==='gmail'?createGmailAdapter(deps):createSmtpImapAdapter(deps));
  const lookup=(accessToken?:string)=>adapter.findSent(accessToken?{...config,credentials:{...config.credentials,accessToken}}:config,send);
  const found=config.mailbox.provider==='gmail'?await withGmailAccess(config.mailbox.id,lookup,{...deps,principal:p}):await lookup();
  if(found?.kind!=='accepted'||found.remoteId!==input.remoteId)throw new AppError(409,'A busca não comprovou a aceitação deste Message-ID, remetente e destinatário. Uma busca vazia mantém o estado incerto.');
  verification='provider-api';
 }
 const snapshot:ReconciliationSnapshot={...input,messageId,attemptId:ctx.attempt.id,verification};
 return {ctx,snapshot,proof:{workspaceId:p.workspaceId,actorId:p.userId,snapshot,fence:Number(ctx.attempt.fence),attemptOutcome:ctx.attempt.outcome}};
}
export async function prepareMailReconciliation(p:Principal,messageId:string,input:Evidence,deps:MailDeps&{adapter?:MailAdapter}={}){
 const ctx=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT app.inspect_uncertain_message($1) AS ctx',[messageId])).rows[0].ctx),state=await mailReconciliationState(p,ctx,messageId,input,deps);
 if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');
 return {snapshot:state.snapshot,token:createReviewToken(state.proof,process.env.BETTER_AUTH_SECRET),expiresAt:new Date(Date.now()+600000).toISOString(),blockers:[]};
}
