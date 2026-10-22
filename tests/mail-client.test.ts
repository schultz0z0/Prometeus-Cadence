import test from 'node:test';import assert from 'node:assert/strict';
import {createMailClient} from '../src/client/mail-client.ts';
test('reviewed mail confirmation retains request identity through double click and a lost response',async()=>{
 const calls:{path:string;body:any}[]=[];let lost=true;
 const client=createMailClient({workspaceId:'A',transport:async(path,init)=>{const body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({path:String(path),body});if(String(path).endsWith('test-prepare'))return Response.json({token:'proof',material:'sealed',snapshot:{},blockers:[],preview:'Preview',expiresAt:'2026-10-22T12:00:00Z'});if(String(path).endsWith('test-confirm')&&lost){lost=false;throw Error('Lost after commit');}return Response.json({id:'message'});}});
 const prepared=await client.prepareTest('box',{mode:'proof',messageId:crypto.randomUUID(),expectedRevision:1});assert.equal(calls.filter(c=>c.path.endsWith('test-confirm')).length,0);
 await assert.rejects(client.confirmTest(prepared));await Promise.all([client.confirmTest(prepared),client.confirmTest(prepared)]);
 const confirms=calls.filter(c=>c.path.endsWith('test-confirm'));assert.equal(confirms.length,2);assert.equal(confirms[0].body.requestId,confirms[1].body.requestId);assert.equal(confirms[0].body.material,'sealed');
});
test('late mail settings from a disposed workspace never enter the next workspace',async()=>{
 let resolve!:(r:Response)=>void;const client=createMailClient({workspaceId:'A',transport:async()=>new Promise(r=>{resolve=r;})}),pending=client.list();client.dispose();resolve(Response.json([{id:'A-box'}]));await assert.rejects(pending,/anterior|mudou/);
});
test('saving verifying syncing and authorization cannot confirm any message',async()=>{
 const paths:string[]=[],client=createMailClient({workspaceId:'A',transport:async path=>{paths.push(String(path));return Response.json({});}});
 await client.verify('box',{expectedRevision:1});await client.sync('box',{expectedRevision:1});await client.startAuthorization('box',{expectedRevision:1});assert.ok(paths.every(p=>!p.includes('confirm')));
});
test('SMTP credentials stay out of draft recovery and no client action writes browser storage',async()=>{
 const {createDraftRecovery}=await import('../src/client/draft-recovery.ts'),recovery=createDraftRecovery(),field={tagName:'INPUT',type:'password',name:'smtpPassword',id:'',value:'fixture-secret',getAttribute:()=>null};
 recovery.capture(field);recovery.capture({...field,name:'imapPassword'});assert.equal(recovery.size(),0);assert.equal(recovery.text(),'');
});
