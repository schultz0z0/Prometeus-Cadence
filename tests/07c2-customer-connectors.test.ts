import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorActionAllowed,connectorCatalog,credentialInputSchema,connectInputSchema} from '../src/domain/connector-capabilities.ts';

test('07C.2 a read connection never authorizes writing a meeting; capabilities and connection gate every action',()=>{
 assert.equal(connectorActionAllowed({action:'calendar.reserve',capabilities:['calendar.read'],connected:true}),false);
 assert.equal(connectorActionAllowed({action:'companies.search',capabilities:['companies.search'],connected:false}),false);
 assert.equal(connectorActionAllowed({action:'companies.search',capabilities:['companies.search'],connected:true}),true);
 assert.equal(connectorActionAllowed({action:'',capabilities:[''],connected:true}),false);
});

test('07C.2 catalog: only connectors with an official contract are available; inputs are bounded',()=>{
 assert.deepEqual(connectorCatalog.filter(c=>c.available).map(c=>c.kind),['apollo']);
 assert.ok(connectorCatalog.find(c=>c.kind==='funnelsflow')!.barrier.length>20);
 assert.equal(credentialInputSchema.safeParse({kind:'apollo',secret:'k'.repeat(22)}).success,true);
 assert.equal(credentialInputSchema.safeParse({kind:'apollo',secret:'short'}).success,false);
 assert.equal(credentialInputSchema.safeParse({kind:'funnelsflow',secret:'k'.repeat(22)}).success,false);
 assert.equal(connectInputSchema.safeParse({kind:'apollo',name:'Conta',credentialRef:crypto.randomUUID(),expectedRevision:0}).success,true);
 assert.equal(connectInputSchema.safeParse({kind:'apollo',name:'Conta',credentialRef:'x',expectedRevision:0}).success,false);
});
