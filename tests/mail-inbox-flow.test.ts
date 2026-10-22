import test from 'node:test';import assert from 'node:assert/strict';
import {createInboxSelection,mergeEmailHistory,emailMessageStatus,lastDisplayedMessage} from '../src/client/mail-inbox-flow.ts';
import type {EmailThreadView,EmailMessageView} from '../src/domain/mail.ts';
const message=(id:string):EmailMessageView=>({id,conversationId:'a',channel:'EMAIL',direction:'outbound',text:'Plain text',mediaKind:null,state:'accepted',remoteId:null,createdAt:'2026-10-22T12:00:00Z',mail:{subject:'Subject',from:'sender@example.org',to:['contact@example.net'],origin:'app',classification:'human',attachments:[],truncated:false,rfcMessageId:'<'+id+'@example.org>',inReplyTo:null,references:[]}});
test('rapid email thread selection rejects old results and disposed selections',()=>{
 const selection=createInboxSelection<{conversation:{id:string}}>(),a=selection.select('A'),b=selection.select('B');assert.equal(selection.accept(a,{conversation:{id:'A'}}),false);assert.equal(selection.accept(b,{conversation:{id:'B'}}),true);assert.equal(selection.current().thread?.conversation.id,'B');selection.dispose();assert.equal(selection.accept(b,{conversation:{id:'B'}}),false);
});
test('email history merges only the selected thread and the read marker is the last displayed message',()=>{
 const current={channel:'EMAIL',conversation:{id:'a'},messages:[message('2'),message('3')],nextCursor:'older'} as EmailThreadView,older={...current,messages:[message('1'),message('2')],nextCursor:null};
 const merged=mergeEmailHistory(current,older);assert.deepEqual(merged.messages.map(m=>m.id),['1','2','3']);assert.equal(lastDisplayedMessage(merged),'3');assert.throws(()=>mergeEmailHistory(current,{...older,conversation:{...older.conversation,id:'b'}}),/conversa/);
});
test('email acceptance and app read markers never claim recipient delivery or read tracking',()=>{
 assert.equal(emailMessageStatus(message('1')),'Aceita pelo provedor');
 assert.equal(emailMessageStatus({...message('1'),state:'read'}),'Rastreamento indisponível');
 assert.equal(emailMessageStatus({...message('1'),state:'delivered'}),'Rastreamento indisponível');
 assert.equal(emailMessageStatus({...message('1'),mail:{...message('1').mail,origin:'external'}}),'Observada em Enviados');
});
