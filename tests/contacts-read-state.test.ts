import test from 'node:test';import assert from 'node:assert/strict';
import * as state from '../src/client/contacts-read-state.ts';
test('old revision or workspace page cannot remain actionable after a current command commits',()=>{
 const visible=(state as any).currentContactsPage;assert.equal(typeof visible,'function');
 const data={revision:1,items:[{id:'lead',qualification:'pending'}]},read={key:'a:query',data};
 assert.equal(visible(read,'a:query',1),data);assert.equal(visible(read,'a:query',2),null);assert.equal(visible(read,'b:query',1),null);assert.equal(visible(read,'a:other-query',1),null);
 assert.equal(visible({...read,data:{...data,revision:3}},'a:query',2)?.revision,3);
});
