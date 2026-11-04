import test from 'node:test';import assert from 'node:assert/strict';import {z} from 'zod';
import {MCP_SCOPES,chooseMcpScopes,normalizeMcpScopes,mcpConfirmRequestId,mcpScopeAllowed} from '../src/domain/mcp-authorization.ts';

test('07C.3b scopes: nothing requested offers all six; unknown ones are dropped',()=>{
 assert.deepEqual(MCP_SCOPES,['contacts.read','jobs.read','metrics.read','messages.read','actions.prepare','actions.confirm']);
 assert.deepEqual(normalizeMcpScopes(null),[...MCP_SCOPES]);
 assert.deepEqual(normalizeMcpScopes('actions.confirm cadences.publish contacts.read'),['contacts.read','actions.confirm']);
 assert.equal(mcpScopeAllowed({required:'actions.confirm',granted:['actions.prepare'],membershipActive:true}),false,'preparing never implies confirming');
});

test('07C.3b consent choice: intersection with the request; confirm needs prepare; nothing chosen is empty',()=>{
 const all=[...MCP_SCOPES];
 assert.deepEqual(chooseMcpScopes(all,undefined),all.filter(s=>s!=='actions.confirm'),'review M2: no explicit choice never grants the opt-in confirm');
 assert.deepEqual(chooseMcpScopes(['contacts.read'],['contacts.read','actions.prepare']),['contacts.read'],'never more than the client asked');
 assert.deepEqual(chooseMcpScopes(all,['metrics.read','actions.confirm']),['metrics.read'],'confirm without prepare is dropped');
 assert.deepEqual(chooseMcpScopes(all,['actions.confirm','actions.prepare']),['actions.prepare','actions.confirm']);
 assert.deepEqual(chooseMcpScopes(all,['admin.all']),[]);
});

test('07C.3b confirmation request id: same proposal and token give the same valid uuid',()=>{
 const a=mcpConfirmRequestId('p1','tok-a');
 assert.equal(a,mcpConfirmRequestId('p1','tok-a'));
 assert.notEqual(a,mcpConfirmRequestId('p1','tok-b'));assert.notEqual(a,mcpConfirmRequestId('p2','tok-a'));
 assert.ok(z.uuid().safeParse(a).success,a);
});

test('07C.3b sign-in returns to the review page of an MCP action only',async()=>{
 const {entryDestination}=await import('../src/domain/registration.ts'),id='0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
 assert.equal(entryDestination('/mcp/review/'+id),'/mcp/review/'+id);
 assert.equal(entryDestination('/mcp/review/'+id+'?x=1'),'/dashboard');assert.equal(entryDestination('/mcp/review/../admin'),'/dashboard');
});
