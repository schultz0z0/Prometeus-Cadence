import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {prospectingUser as createUser,testAdmin} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {readContacts} from '../../src/server/contacts/repository.ts';
import {contactsRequest} from '../../src/server/contacts/http.ts';
import {parseContactsQuery} from '../../src/domain/contacts-query.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
after(async()=>{await getPools().close();});
const user=async()=>{await resetRateLimits();return createUser();};
const everything=()=>parseContactsQuery(new URLSearchParams());
async function seed(ws:string,name:string){const list=randomUUID(),lead=randomUUID();await testAdmin(async c=>{await c.query('INSERT INTO app.list VALUES($1,$2,$3)',[ws,list,'[RE] '+name]);await c.query('INSERT INTO app.lead VALUES($1,$2,$3,$4)',[ws,lead,list,{id:lead,listId:list,name,site:'https://example.com/',source:'MANUAL',qualification:'pending',createdAt:new Date().toISOString()}]);});return lead;}

test('08A two accounts side by side: each reads its own data and nothing of the other',async()=>{
 const a=await user(),b=await user(),la=await seed(a.p.workspaceId,'[RE] Conta A'),lb=await seed(b.p.workspaceId,'[RE] Conta B');
 const [ra,rb]=await Promise.all([readContacts(a.p,everything()),readContacts(b.p,everything())]);
 assert.deepEqual(ra.items.map(i=>i.id),[la]);assert.deepEqual(rb.items.map(i=>i.id),[lb]);
 assert.doesNotMatch(JSON.stringify(ra),/Conta B/);assert.doesNotMatch(JSON.stringify(rb),/Conta A/);
});

test('08A authority: anonymous 401, forged workspace and removed member refused, invalid query 422',async()=>{
 const anonymous=await contactsRequest(new Request('http://127.0.0.1:3210/api/contacts'));assert.equal(anonymous.status,401);assert.doesNotMatch(await anonymous.text(),/stack|postgres|password/i);
 assert.equal((await contactsRequest(new Request('http://127.0.0.1:3210/api/contacts',{method:'POST'}))).status,405);
 const a=await user(),b=await user();await seed(a.p.workspaceId,'[RE] Conta A');
 await assert.rejects(readContacts({...b.p,workspaceId:a.p.workspaceId},everything()),{status:403},'another workspace by id');
 await assert.rejects(readContacts(a.p,{...everything(),pageSize:100000} as never),{status:422});
 assert.equal((await readContacts(a.p,everything())).total,1);
 await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[a.p.workspaceId,a.p.userId]));
 await assert.rejects(readContacts(a.p,everything()),{status:403},'removed member');
});

test('08A over HTTP with the real session: a lead by id, a changed workspace and a removed member',async()=>{
 const a=await user(),b=await user(),la=await seed(a.p.workspaceId,'[RE] Conta A'),request=(extra:HeadersInit={})=>contactsRequest(new Request('http://127.0.0.1:3210/api/contacts',{headers:{cookie:a.headers.get('cookie')!,...extra}}));
 const byId=(p:typeof a.p)=>withWorkspaceTransaction(p,c=>c.query('SELECT id FROM app.lead WHERE id=$1',[la]));
 assert.equal((await byId(a.p)).rowCount,1,'positive control');assert.equal((await byId(b.p)).rowCount,0,'the other account cannot reach it by id');
 const own=await request();assert.equal(own.status,200);assert.match(await own.text(),/Conta A/);
 assert.equal((await request({'x-cadence-workspace':b.p.workspaceId})).status,409,'stale workspace in the client');
 await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[a.p.workspaceId,a.p.userId]));
 const removed=await request();assert.ok([401,403].includes(removed.status),String(removed.status));assert.doesNotMatch(await removed.text(),/Conta A/);
});
