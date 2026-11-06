import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {activeChild,navigation,pageTitle} from '../src/components/shell/navigation.ts';

const messages=navigation.find(n=>n.label==='Mensagens')!;
const read=(p:string)=>readFileSync(p,'utf8');

test('/inbox belongs to Mensagens, so the group opens and E-mail is marked',()=>{
 assert.equal(activeChild(messages,'/inbox')?.label,'E-mail');
 assert.equal(activeChild(messages,'/messages/whatsapp')?.label,'WhatsApp');
});

test('the breadcrumb names the page instead of repeating its group',()=>{
 assert.equal(pageTitle('/inbox'),'E-mail');
 assert.equal(pageTitle('/messages/email'),'E-mail');
 assert.equal(pageTitle('/messages/whatsapp'),'WhatsApp');
 assert.equal(pageTitle('/first-steps'),'Primeiros passos');
});

test('with no channel, the inboxes lead to the connection instead of an empty list',()=>{
 const whatsapp=read('src/modules/messages/whatsapp-inbox.tsx'),email=read('src/modules/messages/email-inbox.tsx');
 assert.match(whatsapp,/WhatsApp não configurado/);
 assert.match(whatsapp,/canManage&&<LinkButton href="\/settings\/whatsapp"[^>]*>Conectar WhatsApp/);
 assert.match(whatsapp,/!search&&!senderFilter&&!connections\.length/,'a search with no result keeps the search box');
 assert.match(email,/Conecte uma conta de e-mail/);
 assert.match(email,/canManage&&<LinkButton href="\/settings\/email"[^>]*>Conectar e-mail/);
});

test('pipeline and reports open the Help Center guide, as the reference does',()=>{
 for(const file of ['src/modules/cadences/pipeline.tsx','src/modules/reports/reports.tsx'])assert.match(read(file),/Leia o guia na Central de Ajuda/);
 assert.match(read('src/components/shell/app-shell.tsx'),/addEventListener\('help-open'/);
});
