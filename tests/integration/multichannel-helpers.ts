import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {getPools} from '../../src/server/db/pool.ts';import {closeDispatchPool} from '../../src/server/messaging/worker-db.ts';import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
import {publicationFixture} from './messaging-helpers.ts';import {testAdmin,smtpMailboxInput} from './mail-helpers.ts';
import {saveMailbox} from '../../src/server/mail/repository.ts';import {preparePublication,confirmPublication} from '../../src/server/messaging/publication.ts';
import {prepareChannelTest,confirmChannelTest} from '../../src/server/messaging/replies.ts';
import {materializeDueMessages} from '../../src/server/messaging/outbox.ts';import type {PublicationInputV2} from '../../src/domain/cadence-runtime.ts';
export async function multiFixture(emailOnly=false){
 const f=await publicationFixture(),mailbox=await saveMailbox(f.u.p,smtpMailboxInput()),senderId=randomUUID(),identity=randomUUID();
 process.env.MAIL_PUBLIC_BASE_URL='https://mail-hooks.example';
 const lead={...f.lead,email:'contact@example.net',...(emailOnly?{phone:undefined}:{})};
 const cadence={...f.cadence,steps:emailOnly?[{id:'first',channel:'EMAIL' as const,delayDays:0,subject:'Olá {{nome}}',body:'Podemos conversar?',stopOnReply:true}]:[{id:'first',channel:'EMAIL' as const,delayDays:0,subject:'Olá {{nome}}',body:'Podemos conversar?',stopOnReply:true},f.cadence.steps[1],{id:'third',channel:'EMAIL' as const,delayDays:4,subject:'Re: Olá {{nome}}',body:'Retomando nosso contato',stopOnReply:true}]};
 await testAdmin(async c=>{
  await c.query("UPDATE app.channel_connection SET state='ready',credentials_verified=true WHERE id=$1",[mailbox.id]);
  await c.query("UPDATE app.email_mailbox SET state='ready',send_verified=true,read_verified=true,proof_verified=true,baseline_at=clock_timestamp(),last_synced_at=clock_timestamp(),sync_state='ready' WHERE id=$1",[mailbox.id]);
  await c.query("INSERT INTO app.channel_sender(workspace_id,id,connection_id,provider,channel,address,external_id,identity_scope,ready,daily_limit) VALUES($1,$2,$3,'smtp-imap','EMAIL',$4,$4,'email',true,10)",[f.u.p.workspaceId,senderId,mailbox.id,mailbox.address]);
  await c.query("INSERT INTO app.messaging_channel_limits(workspace_id,channel,daily_limit) VALUES($1,'EMAIL',10)",[f.u.p.workspaceId]);
  await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES($1,$2,'email',$3)",[f.u.p.workspaceId,identity,lead.email]);
  await c.query("INSERT INTO app.consent_evidence(workspace_id,id,identity_id,purpose,source,occurred_at,evidence,actor_id) VALUES($1,$2,$3,'campaign','Fixture',clock_timestamp(),'Explicit fixture authorization',$4)",[f.u.p.workspaceId,randomUUID(),identity,f.u.p.userId]);
  await c.query('UPDATE app.lead SET payload=$2 WHERE id=$1',[lead.id,lead]);await c.query('UPDATE app.cadence SET payload=$2 WHERE id=$1',[cadence.id,cadence]);
 });
 const email={kind:'email' as const,subject:'Olá {{nome}}',text:'Podemos conversar?',signature:'Equipe QA'};
 const input:PublicationInputV2={version:2,cadenceId:cadence.id,expectedRevision:0,leadIds:[lead.id],steps:{first:{senderId,content:email},...(!emailOnly?{second:{senderId:f.sender.id,content:f.input.bindings.second},third:{senderId,content:{...email,subject:'Re: Olá {{nome}}',text:'Retomando nosso contato'}}}:{})}};
 return {...f,mailbox,mailSenderId:senderId,emailIdentity:identity,lead,cadence,input};
}