import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dayLabel,mergeLatest,nearBottom,nextScrollTop,prependOlder} from '../src/client/whatsapp-thread.ts';
const msg=(id:string,state='received')=>({id,state,text:id}) as never;
const read=(p:string)=>readFileSync(p,'utf8');
test('an older page goes on top, keeps what is shown and moves the cursor back',()=>{
 const old={messages:[msg('c'),msg('d')],nextCursor:'30',conversation:'x'};
 const next=prependOlder(old,{messages:[msg('a'),msg('b'),msg('c')],nextCursor:'10'});
 assert.deepEqual(next.messages.map((m:{id:string})=>m.id),['a','b','c','d']);assert.equal(next.nextCursor,'10');assert.equal(next.conversation,'x');
});
test('a live poll updates states and appends without dropping older pages or their cursor',()=>{
 const old={messages:[msg('a'),msg('b'),msg('c','pending')],nextCursor:'10'};
 const next=mergeLatest(old,{messages:[msg('c','delivered'),msg('d')],nextCursor:'50'});
 assert.deepEqual(next.messages.map((m:{id:string})=>m.id),['a','b','c','d']);
 assert.equal((next.messages[2] as {state:string}).state,'delivered');assert.equal(next.nextCursor,'10');
});
test('scroll: prepend keeps the reading position, new messages follow only at the bottom',()=>{
 assert.equal(nextScrollTop({scrollHeight:1500,scrollTop:40,prevHeight:1000,prepended:true,stick:false}),540);
 assert.equal(nextScrollTop({scrollHeight:1500,scrollTop:300,prevHeight:1000,prepended:false,stick:true}),1500);
 assert.equal(nextScrollTop({scrollHeight:1500,scrollTop:300,prevHeight:1000,prepended:false,stick:false}),300);
 assert.equal(nearBottom({scrollHeight:1000,scrollTop:560,clientHeight:400}),true);
 assert.equal(nearBottom({scrollHeight:1000,scrollTop:300,clientHeight:400}),false);
});
test('day separators read like a chat',()=>{
 const now=new Date(2026,10,14,15);
 assert.equal(dayLabel(new Date(2026,10,14,1).toISOString(),now),'Hoje');
 assert.equal(dayLabel(new Date(2026,10,13,23).toISOString(),now),'Ontem');
 assert.equal(dayLabel(new Date(2026,9,1,12).toISOString(),now),'01/10/2026');
});
test('composer: Enter sends, Shift+Enter breaks the line, emojis go in at the caret, review stays for blockers and retries',()=>{
 const reply=read('src/modules/messages/whatsapp-reply.tsx');
 assert.match(reply,/e\.key==='Enter'&&!e\.shiftKey&&!e\.nativeEvent\.isComposing/);
 assert.match(reply,/<EmojiPicker onPick=\{insert\}/);
 assert.match(reply,/if\(p\.review\.blockers\.length\)\{setPrepared\(p\);return;\}/);
 // A failed confirmation keeps the same prepared command for the retry, so a lost response never sends twice.
 assert.match(reply,/catch\(e\)\{flow\.accept\(flow\.begin\(\),p\.review\);setPrepared\(p\);throw e;\}/);
});
test('inbox: fixed columns, SDR panel docked, history merged instead of reloaded',()=>{
 const inbox=read('src/modules/messages/whatsapp-inbox.tsx'),css=read('src/app/globals.css');
 assert.match(inbox,/<WhatsappHistory /);assert.match(inbox,/whatsapp-sdr-dock"><SdrConversationControls/);
 assert.doesNotMatch(inbox,/setThread\(value\)/,'a refresh must not throw away older pages');
 assert.match(css,/\.inbox-layout\.whatsapp-inbox \{ height: max\(460px, calc\(100dvh - \d+px\)\)/);
 assert.match(css,/\.whatsapp-history \{[^}]*overflow: auto;[^}]*overflow-anchor: none;/);
});
