import test from 'node:test';
import assert from 'node:assert/strict';
import {filterLeads} from '../src/domain/leads.ts';
import * as query from '../src/domain/contacts-query.ts';
import type {Lead} from '../src/domain/model.ts';
const make=(id:string,extra:Partial<Lead>={}):Lead=>({id,listId:'list',name:'Acme',createdAt:'2026-10-25T23:59:59Z',qualification:'pending',source:'MANUAL',...extra});
test('contact filters compose and dates are inclusive UTC days with stable tie ordering',()=>{
 const rows=[make('b',{email:'x@example.com',state:'SP'}),make('a',{email:'a@example.com',state:'SP'}),make('c',{phone:'11999999999',state:'RJ'}),make('future',{email:'x@example.com',state:'SP',createdAt:'2026-10-26T00:00:00Z'})];
 const result=filterLeads(rows,{contact:'email',state:'SP',createdFrom:'2026-10-25',createdTo:'2026-10-25',sort:'name'} as any);
 assert.deepEqual(result.map(l=>l.id),['a','b']);assert.equal(filterLeads(rows,{contact:'none'} as any).length,0);
});
test('strict pagination rejects duplicate keys, malformed dates, invalid enums and excessive pages',()=>{
 const parse=(query as any).parseContactsQuery;
 assert.equal(typeof parse,'function');
 assert.equal(parse(new URLSearchParams()).pageSize,20);
 for(const value of ['page=0','pageSize=101','page=5001','search=x&search=y','source=FAKE','createdFrom=2026-02-30','createdFrom=2026-10-26&createdTo=2026-10-25','unexpected=1'])assert.throws(()=>parse(new URLSearchParams(value)));
});
