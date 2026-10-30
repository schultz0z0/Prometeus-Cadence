import test from 'node:test';import assert from 'node:assert/strict';
import{notificationAllowed,quietUntil,summaryWindow,notificationSound,notificationPreferencesSchema,defaultNotificationPreferences}from'../src/domain/notifications.ts';
test('notification delivery requires enabled channel, verified destination and nonquiet state',()=>{
 for(const enabled of[true,false])for(const quiet of[true,false])for(const verifiedDestination of[true,false])assert.equal(notificationAllowed({enabled,quiet,verifiedDestination}),enabled&&!quiet&&verifiedDestination);
});
test('quiet window crosses midnight and resolves local daylight saving boundaries',()=>{
 const q={timezone:'America/Sao_Paulo',start:'22:00',end:'08:00'};
 assert.equal(quietUntil('2026-10-29T02:00:00Z',q),'2026-10-29T11:00:00.000Z');
 assert.equal(quietUntil('2026-10-29T11:00:00Z',q),null);
 assert.equal(quietUntil('2026-10-29T01:00:00Z',q),'2026-10-29T11:00:00.000Z');
 assert.equal(quietUntil('2026-11-01T05:30:00Z',{timezone:'America/New_York',start:'22:00',end:'08:00'}),'2026-11-01T13:00:00.000Z');
 assert.equal(quietUntil('2026-10-29T00:00:00Z',{...q,start:'12:00',end:'12:00'}),null);
});
test('weekly summary uses preceding complete local calendar week and one next occurrence',()=>{
 const w=summaryWindow('2026-11-02T14:00:00Z','weekly','09:00','America/New_York');
 assert.deepEqual(w,{from:'2026-10-26T04:00:00.000Z',to:'2026-11-02T05:00:00.000Z',next:'2026-11-09T14:00:00.000Z'});
});
test('sound only signals a fresh visible change after an initialized baseline',()=>{
 const base={enabled:true,visible:true,activated:true,previous:'8',current:'9',latestAt:Date.now(),now:Date.now()};
 assert.equal(notificationSound(base),true);for(const override of[{previous:null},{visible:false},{activated:false},{latestAt:0},{previous:'9'}])assert.equal(notificationSound({...base,...override}),false);
});
test('preference contract rejects unrecognized destinations, invalid zones and duplicate events',()=>{
 const p=defaultNotificationPreferences;assert.equal(notificationPreferencesSchema.safeParse(p).success,true);
 for(const extra of[{destination:'other@example.com'},{quiet:{timezone:'Wrong/Zone',start:'22:00',end:'08:00'}},{events:['lead_reply','lead_reply']}])assert.equal(notificationPreferencesSchema.safeParse({...p,...extra}).success,false);
});
