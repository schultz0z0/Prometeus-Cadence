import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorActionAllowed,connectorCatalog,credentialInputSchema,connectInputSchema,sheetRow,sheetHeaders,sheetSetupSchema} from '../src/domain/connector-capabilities.ts';

test('07C.2 a read connection never authorizes writing a meeting; capabilities and connection gate every action',()=>{
 assert.equal(connectorActionAllowed({action:'calendar.reserve',capabilities:['calendar.read'],connected:true}),false);
 assert.equal(connectorActionAllowed({action:'companies.search',capabilities:['companies.search'],connected:false}),false);
 assert.equal(connectorActionAllowed({action:'companies.search',capabilities:['companies.search'],connected:true}),true);
 assert.equal(connectorActionAllowed({action:'',capabilities:[''],connected:true}),false);
});

test('07C.2 catalog: only connectors with an official contract are available; inputs are bounded',()=>{
 assert.deepEqual(connectorCatalog.filter(c=>c.available).map(c=>c.kind),['apollo','google-sheets']);
 assert.ok(connectorCatalog.find(c=>c.kind==='funnelsflow')!.barrier.length>20);
 assert.equal(credentialInputSchema.safeParse({kind:'apollo',secret:'k'.repeat(22)}).success,true);
 assert.equal(credentialInputSchema.safeParse({kind:'apollo',secret:'short'}).success,false);
 assert.equal(credentialInputSchema.safeParse({kind:'funnelsflow',secret:'k'.repeat(22)}).success,false);
 assert.equal(connectInputSchema.safeParse({kind:'apollo',name:'Conta',credentialRef:crypto.randomUUID(),expectedRevision:0}).success,true);
 assert.equal(connectInputSchema.safeParse({kind:'apollo',name:'Conta',credentialRef:'x',expectedRevision:0}).success,false);
});

test('07C.2b a sheet row starts with the lead id, follows the chosen columns and never builds a formula',()=>{
 assert.deepEqual(sheetHeaders(['name','email','list']),['ID Cadence','Nome','E-mail','Lista']);
 const row=sheetRow({id:'l1',name:'=HYPERLINK("x")',email:'a@example.com',qualification:'qualified',extra:'ignored'},['name','qualification','list','event','city'],{list:'Base',event:'lead.connected',channel:'EMAIL',exportedAt:'2026-11-03T10:00:00Z'});
 // RAW input keeps the leading '=' as text in Sheets; the row itself only maps declared fields.
 assert.deepEqual(row,['l1','=HYPERLINK("x")','Qualificado','Base','Lead respondeu (e-mail)','']);
 const ok={spreadsheetName:'Leads',sheetTitle:'Leads 2026',columns:['name','email'],events:['lead.created'],expectedRevision:0};
 assert.equal(sheetSetupSchema.safeParse(ok).success,true);
 for(const bad of[{columns:['name','name']},{columns:['password']},{sheetTitle:"Leads'!A1"},{events:[]},{formula:'=1'}])
  assert.equal(sheetSetupSchema.safeParse({...ok,...bad}).success,false,JSON.stringify(bad));
});
