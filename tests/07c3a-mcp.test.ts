import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {mcpScopeAllowed,normalizeMcpScopes,validMcpRedirectUri,pkceS256Matches,negotiateMcpVersion,MCP_SCOPES} from '../src/domain/mcp-authorization.ts';
test('07C.3a a scope only grants itself, and only to a current member',()=>{
 assert.equal(mcpScopeAllowed({required:'cadences.publish',granted:['contacts.read'],membershipActive:true}),false);
 assert.equal(mcpScopeAllowed({required:'contacts.read',granted:['contacts.read'],membershipActive:true}),true);
 assert.equal(mcpScopeAllowed({required:'contacts.read',granted:['contacts.read'],membershipActive:false}),false);
});
test('07C.3a requested scopes keep only the known ones; none asked means every scope (07C.3b)',()=>{
 assert.deepEqual(normalizeMcpScopes('contacts.read admin.all jobs.read'),['contacts.read','jobs.read']);
 assert.deepEqual(normalizeMcpScopes(undefined),[...MCP_SCOPES],'07C.3b: nothing requested offers every scope');
 assert.deepEqual(normalizeMcpScopes('admin.all'),[],'nothing known: nothing granted');
});
test('07C.3a redirect URIs: https, or http on the loopback only',()=>{
 for(const ok of ['https://claude.ai/api/mcp/auth_callback','https://chatgpt.com/connector_platform_oauth_redirect','http://localhost:6274/oauth/callback','http://127.0.0.1:33418/cb'])assert.equal(validMcpRedirectUri(ok),true,ok);
 for(const bad of ['http://example.com/cb','javascript:alert(1)','https://x.example/cb#frag','ftp://x/cb','https://user:pw@x.example/cb','notaurl','https://'+'a'.repeat(600)+'.example/'])assert.equal(validMcpRedirectUri(bad),false,bad.slice(0,30));
});
test('07C.3a PKCE S256 and protocol versions',()=>{
 const verifier='dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',challenge=createHash('sha256').update(verifier).digest('base64url');
 assert.equal(pkceS256Matches(verifier,challenge),true);assert.equal(pkceS256Matches(verifier+'x',challenge),false);assert.equal(pkceS256Matches('short',createHash('sha256').update('short').digest('base64url')),false,'RFC 7636: 43 to 128 characters');
 assert.equal(negotiateMcpVersion('2025-06-18'),'2025-06-18');assert.equal(negotiateMcpVersion('2099-01-01'),'2025-11-25');
});
