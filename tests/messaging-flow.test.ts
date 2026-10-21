import test from 'node:test';import assert from 'node:assert/strict';
import {createMessagingFlow,canBlindRetry} from '../src/client/messaging-flow.ts';
import {createMessagingClient} from '../src/client/messaging-client.ts';
const review={token:'proof',expiresAt:'2099-01-01T00:00:00Z',snapshot:{},blockers:[]};
test('changed text sender or template invalidates preview; result A never enters B',()=>{
 const flow=createMessagingFlow('workspace:conversation:A');
 for(const changed of ['new text','new sender','new template']){const ticket=flow.begin();flow.edit(changed);assert.equal(flow.accept(ticket,review),false);assert.equal(flow.current().kind,'editing');}
 const ticket=flow.begin();assert.equal(flow.accept(ticket,review),true);assert.equal(flow.current().kind,'reviewing');flow.edit('workspace:conversation:B');assert.equal(flow.confirm(),null);
 assert.equal(flow.accept(ticket,review),false);
});
test('blocked expired and uncertain reviews do not authorize blind sends',()=>{
 const flow=createMessagingFlow('a');let ticket=flow.begin();flow.accept(ticket,{...review,blockers:['CONSENT_REQUIRED']});assert.equal(flow.current().kind,'blocked');assert.equal(flow.confirm(),null);
 ticket=flow.begin();flow.accept(ticket,{...review,expiresAt:'2020-01-01T00:00:00Z'});assert.equal(flow.confirm(),null);
 assert.equal(canBlindRetry('uncertain'),false);assert.equal(canBlindRetry('dispatching'),false);
});
test('reading and marking read never enqueue; AI output has no implicit publication',async()=>{
 const paths:string[]=[];const c=createMessagingClient({workspaceId:'a',transport:async(url)=>{paths.push(String(url));return Response.json({items:[]});}});
 await c.listConversations({search:'empresa'});await c.readConversation('a');await c.markRead('a','last');
 assert.equal(paths.filter(p=>p.includes('confirm')).length,0);
 const flow=createMessagingFlow('ai-draft');flow.edit('suggested content');assert.equal(paths.filter(p=>p.includes('publication')).length,0);
});
test('reply confirm retries one identity and disposed workspace drops late thread data',async()=>{
 const bodies:any[]=[];let fail=true;
 const c=createMessagingClient({workspaceId:'a',transport:async(url,init)=>{if(String(url).endsWith('reply-prepare'))return Response.json({...review,preview:'Oi'});bodies.push(JSON.parse(String(init?.body)));if(fail)throw Error('lost');return Response.json({id:'message'});}});
 const r=await c.prepareReply('thread',{content:{kind:'text',text:'Oi'}});const a=c.confirmReply(r),b=c.confirmReply(r);assert.equal(a,b);await assert.rejects(a);fail=false;await c.confirmReply(r);assert.equal(bodies[0].requestId,bodies[1].requestId);
 let resolve!:(r:Response)=>void;const old=createMessagingClient({workspaceId:'old',transport:()=>new Promise(r=>resolve=r)});const pending=old.readConversation('thread');old.dispose();resolve(Response.json({messages:[]}));await assert.rejects(pending);
});
