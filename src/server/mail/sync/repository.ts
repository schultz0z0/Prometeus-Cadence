import 'server-only';
import type {SyncLease} from '../../../domain/mail.ts';
import type {MailConfig} from '../contracts.ts';
import {dispatchPool} from '../../messaging/worker-db.ts';
import {decryptCredential,encryptCredential} from '../../channels/crypto.ts';
import type {MailDeps} from '../providers/contracts.ts';
import {gmailOAuthSettings} from '../oauth-protocol.ts';
import {tokenRequest} from '../oauth.ts';
import {setTimeout as delay} from 'node:timers/promises';
export const syncArgs=(lease:SyncLease)=>[lease.workspaceId,lease.mailboxId,lease.token,lease.fence];
export async function claimMailboxSync(now:string,scope:{workspaceId?:string;mailboxId?:string;limit:number}):Promise<SyncLease[]> {
 if(!Number.isFinite(Date.parse(now))||!Number.isInteger(scope.limit)||scope.limit<1||scope.limit>10||(scope.mailboxId&&!scope.workspaceId))throw Error('INVALID_SYNC_SCOPE');
 return(await dispatchPool().query('SELECT app.claim_mail_sync($1,$2,$3,$4) AS leases',[now,scope.workspaceId??null,scope.mailboxId??null,scope.limit])).rows[0].leases;
}
export async function readSyncConfig(lease:SyncLease):Promise<MailConfig> {
 const data=(await dispatchPool().query('SELECT app.read_mail_sync($1,$2,$3,$4) AS context',syncArgs(lease))).rows[0].context;
 const {mailbox:m,connection:c,sender:s}=data;if(Number(c.revision)!==lease.revision)throw Error('MAIL_REVISION_CHANGED');
 return {mailbox:{id:m.id,senderId:s?.id??null,provider:c.provider,name:c.name,address:m.address,revision:Number(c.revision),state:m.state,hasSecrets:true,sendVerified:m.send_verified,readVerified:m.read_verified,lastSyncedAt:m.last_synced_at,syncState:m.sync_state,dailyLimit:s?.daily_limit??null,signature:m.signature,lastError:m.last_error},config:c.identifiers.config,credentials:decryptCredential(data.envelope,{workspaceId:lease.workspaceId,connectionId:m.id,provider:c.provider,revision:Number(c.revision)}),cursor:data.cursor};
}
export async function heartbeatMailboxSync(lease:SyncLease){await dispatchPool().query('SELECT app.heartbeat_mail_sync($1,$2,$3,$4)',syncArgs(lease));}
export async function failMailboxSync(lease:SyncLease,recovery:boolean,code:string){await dispatchPool().query('SELECT app.fail_mail_sync($1,$2,$3,$4,$5,$6)',[...syncArgs(lease),recovery,code]);}
export async function ensureSyncGmailAccess(lease:SyncLease,deps:MailDeps={}):Promise<MailConfig> {
 const fresh=(config:MailConfig)=>config.credentials.accessToken&&Date.parse(config.credentials.expiresAt)>Date.parse(deps.now?.()??new Date().toISOString())+30000;
 const apply=async(action:string,envelope:unknown=null,expires:string|null=null,error:string|null=null)=>(await dispatchPool().query('SELECT app.sync_mail_refresh($1,$2,$3,$4,$5,$6,$7,$8,$9) AS ok',[...syncArgs(lease),lease.revision,action,envelope,expires,error])).rows[0].ok;
 for(let attempt=0;attempt<100;attempt++){
  let config=await readSyncConfig(lease);if(config.mailbox.provider!=='gmail'||fresh(config))return config;
  if(!await apply('claim')){await delay(50);continue;}
  config=await readSyncConfig(lease);if(fresh(config)){await apply('failure',null,null,'already_fresh');return config;}
  let data:Record<string,any>;
  try{const settings=gmailOAuthSettings();data=await tokenRequest(new URLSearchParams({grant_type:'refresh_token',client_id:settings.clientId,client_secret:settings.clientSecret,refresh_token:config.credentials.refreshToken}),deps);}
  catch(error){const code=error instanceof Error&&error.message==='GMAIL_INVALID_GRANT'?'invalid_grant':'refresh_failed';await apply('failure',null,null,code);throw Error('GMAIL_REFRESH_FAILED');}
  const expiresAt=new Date(Date.parse(deps.now?.()??new Date().toISOString())+data.expires_in*1000).toISOString(),credentials={...config.credentials,accessToken:data.access_token,expiresAt,...(typeof data.refresh_token==='string'&&data.refresh_token?{refreshToken:data.refresh_token}:{})};
  const envelope=encryptCredential(credentials,{workspaceId:lease.workspaceId,connectionId:lease.mailboxId,provider:'gmail',revision:lease.revision});
  if(!await apply('commit',envelope,expiresAt))throw Error('STALE_SYNC_LEASE');return {...config,credentials};
 }throw Error('GMAIL_REFRESH_BUSY');
}
