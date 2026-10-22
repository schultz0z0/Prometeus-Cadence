import test from 'node:test';import assert from 'node:assert/strict';
import {createMessagingFlow} from '../src/client/messaging-flow.ts';
import {buildPublicationInputV2} from '../src/client/mail-client.ts';
import {defaultCadenceSettings} from '../src/demo/seed.ts';
const cadence={id:'cadence',name:'Email',listId:'list',status:'draft' as const,createdAt:'2026-10-21',settings:defaultCadenceSettings(),steps:[{id:'one',channel:'EMAIL' as const,subject:'Olá',body:'Mensagem',delayDays:0,stopOnReply:true}]};
test('email publication requires each step sender but never introduces a telephone dependency',()=>{
 assert.throws(()=>buildPublicationInputV2(cadence,1,['email-only'],{}),/remetente/i);
 const input=buildPublicationInputV2(cadence,1,['email-only'],{one:{senderId:'mail-sender',content:{kind:'email',subject:'Olá',text:'Mensagem',signature:'Equipe'}}});assert.equal(input.version,2);assert.deepEqual(input.leadIds,['email-only']);assert.equal(input.steps.one.senderId,'mail-sender');
});
test('changing mailbox signature address or workspace rejects an earlier preview ticket',()=>{
 for(const change of ['mailbox','signature','address','workspace']){const flow=createMessagingFlow('initial'),ticket=flow.begin();flow.edit(change);assert.equal(flow.accept(ticket,{token:'old',expiresAt:'2099-01-01',snapshot:{},blockers:[]}),false);assert.equal(flow.confirm(),null);}
});
