import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorActionAllowed,connectorCatalog,credentialInputSchema,connectInputSchema,sheetRow,sheetHeaders,sheetSetupSchema,zonedTime,candidateSlots,freeSlots,calendarSetupSchema} from '../src/domain/connector-capabilities.ts';

test('07C.2 a read connection never authorizes writing a meeting; capabilities and connection gate every action',()=>{
 assert.equal(connectorActionAllowed({action:'calendar.reserve',capabilities:['calendar.read'],connected:true}),false);
 assert.equal(connectorActionAllowed({action:'companies.search',capabilities:['companies.search'],connected:false}),false);
 assert.equal(connectorActionAllowed({action:'companies.search',capabilities:['companies.search'],connected:true}),true);
 assert.equal(connectorActionAllowed({action:'',capabilities:[''],connected:true}),false);
});

test('07C.2 catalog: only connectors with an official contract are available; inputs are bounded',()=>{
 assert.deepEqual(connectorCatalog.filter(c=>c.available).map(c=>c.kind),['apollo','google-sheets','google-calendar']);
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

test('07C.2c wall-clock times convert through the zone, including across a DST change',()=>{
 assert.equal(zonedTime('2026-11-09','09:00','America/Sao_Paulo').toISOString(),'2026-11-09T12:00:00.000Z');
 assert.equal(zonedTime('2026-03-06','09:00','America/New_York').toISOString(),'2026-03-06T14:00:00.000Z');
 assert.equal(zonedTime('2026-03-09','09:00','America/New_York').toISOString(),'2026-03-09T13:00:00.000Z');
});

test('07C.2c slots follow weekdays, hours, duration, notice and horizon; busy intervals remove overlapping slots',()=>{
 const config={calendarId:'primary' as const,timezone:'America/Sao_Paulo',weekdays:[1,2,3,4,5],start:'09:00',end:'11:00',durationMinutes:30 as const,noticeHours:2,horizonDays:7};
 const now=Date.parse('2026-11-06T12:30:00Z');// Friday 09:30 local
 const slots=candidateSlots(config,now,Date.parse('2026-11-09T23:00:00Z'),now);
 // Friday from 11:30 local is past the 2 h notice and outside hours; Saturday/Sunday skipped; Monday 09:00..10:30.
 assert.deepEqual(slots.map(s=>new Date(s.start).toISOString()),['2026-11-09T12:00:00.000Z','2026-11-09T12:30:00.000Z','2026-11-09T13:00:00.000Z','2026-11-09T13:30:00.000Z']);
 assert.equal(slots[0].end-slots[0].start,1800000);
 const free=freeSlots(slots,[{start:Date.parse('2026-11-09T12:45:00Z'),end:Date.parse('2026-11-09T13:05:00Z')}]);
 assert.deepEqual(free.map(s=>new Date(s.start).toISOString()),['2026-11-09T12:00:00.000Z','2026-11-09T13:30:00.000Z']);
 // Horizon caps the window even when the query asks for more.
 assert.equal(candidateSlots({...config,horizonDays:1},now,now+10*86400000,now).length,0);
 const ok={timezone:'America/Sao_Paulo',weekdays:[1,2,3],start:'09:00',end:'18:00',durationMinutes:30,noticeHours:4,horizonDays:14,expectedRevision:0};
 assert.equal(calendarSetupSchema.safeParse(ok).success,true);
 for(const bad of[{timezone:'Mars/Base'},{weekdays:[]},{weekdays:[7]},{start:'18:00',end:'09:00'},{start:'9h'},{durationMinutes:20},{horizonDays:90},{noticeHours:-1}])
  assert.equal(calendarSetupSchema.safeParse({...ok,...bad}).success,false,JSON.stringify(bad));
});
