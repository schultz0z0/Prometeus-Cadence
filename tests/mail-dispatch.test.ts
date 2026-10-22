import test from 'node:test';import assert from 'node:assert/strict';
import {dispatchBlocker} from '../src/server/messaging/guard.ts';
const now='2026-10-21T12:00:00Z';
function context(){return {outbox:{prepared_send:{channel:'EMAIL',connectionRevision:1,address:'from@example.org',to:'to@example.org',purpose:'campaign',content:{kind:'email',subject:'Olá',text:'Texto',signature:''}},proof:{senderRevision:1}},connection:{state:'ready',credentials_verified:true,revision:1,channel:'EMAIL'},sender:{ready:true,revision:1,address:'from@example.org',channel:'EMAIL'},identity:{scope:'email',external_id:'to@example.org'},mailbox:{state:'ready',sync_state:'ready',last_synced_at:now,signature:'',bounce_paused:false},channelLimits:{daily_limit:80},consents:['consent'],suppressions:[]};}
test('email dispatch requires fresh sync and independent authorization without a WhatsApp service window',()=>{
 const ctx=context();assert.equal(dispatchBlocker(ctx,now),null);
 ctx.mailbox.last_synced_at='2026-10-21T11:54:59Z';assert.equal(dispatchBlocker(ctx,now),'EMAIL_SYNC_REQUIRED');
 ctx.mailbox.last_synced_at=now;ctx.consents=[];assert.equal(dispatchBlocker(ctx,now),'EMAIL_AUTHORIZATION_REQUIRED');
});
test('email mailbox holds and changed address fail closed',()=>{
 const ctx=context();ctx.identity.external_id='other@example.org';assert.equal(dispatchBlocker(ctx,now),'CONTACT_CHANGED');
 ctx.identity.external_id='to@example.org';ctx.mailbox.bounce_paused=true;assert.equal(dispatchBlocker(ctx,now),'SENDER_UNAVAILABLE');
});
