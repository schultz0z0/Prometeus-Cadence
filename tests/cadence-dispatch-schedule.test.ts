import test from 'node:test';
import assert from 'node:assert/strict';
import {nextStepAt,dispatchTimeAllowed} from '../src/server/messaging/schedule.ts';
const base={anchorAt:'2026-10-23T12:00:00Z',delayDays:1,now:'2026-10-23T12:00:00Z',timezone:'America/Sao_Paulo',weekdays:[1,2,3,4,5],sendTime:'09:00',skipHolidays:false,holidayDates:null};
test('delay begins at acceptance and weekdays follow the local calendar',()=>{
 assert.equal(nextStepAt(base),'2026-10-26T12:00:00.000Z');
 assert.equal(nextStepAt({...base,delayDays:0,anchorAt:'2026-10-21T13:00:00Z',now:'2026-10-21T13:00:00Z'}),'2026-10-22T12:00:00.000Z');
 assert.equal(nextStepAt({...base,delayDays:0,anchorAt:'2026-10-21T12:00:00Z',now:'2026-10-21T12:00:00Z'}),'2026-10-21T12:00:00.000Z');
});
test('dst_gap_overlap uses first valid scheduled local instant',()=>{
 const ny={...base,timezone:'America/New_York',weekdays:[0,1,2,3,4,5,6]};
 assert.equal(nextStepAt({...ny,anchorAt:'2026-03-07T07:30:00Z',now:'2026-03-07T07:30:00Z',sendTime:'02:30'}),'2026-03-08T07:00:00.000Z');
 assert.equal(nextStepAt({...ny,anchorAt:'2026-10-31T05:30:00Z',now:'2026-10-31T05:30:00Z',sendTime:'01:30'}),'2026-11-01T05:30:00.000Z');
});
test('downtime yields a future allowed time without shortening the predecessor delay',()=>{
 assert.equal(nextStepAt({...base,now:'2026-10-28T13:00:00Z'}),'2026-10-29T12:00:00.000Z');
 assert.equal(nextStepAt({...base,anchorAt:'2026-10-28T13:00:00Z',now:'2026-10-28T13:00:00Z',delayDays:4}),'2026-11-02T12:00:00.000Z');
});
test('holiday skipping requires explicit calendar; invalid and unbounded inputs fail closed',()=>{
 assert.throws(()=>nextStepAt({...base,skipHolidays:true}),/calendário/i);
 assert.equal(nextStepAt({...base,skipHolidays:true,holidayDates:['2026-10-26']}),'2026-10-27T12:00:00.000Z');
 for(const change of [{weekdays:[]},{delayDays:-1},{delayDays:0.5},{sendTime:'25:00'},{timezone:'invalid'},{anchorAt:'bad'},{weekdays:[8]}])assert.throws(()=>nextStepAt({...base,...change}));
});
test('queued dispatch may finish after its starting minute but never on excluded days or before the local sending time',()=>{
 assert.equal(dispatchTimeAllowed('2026-10-21T12:00:03Z',base),true);
 assert.equal(dispatchTimeAllowed('2026-10-21T11:59:59Z',base),false);
 assert.equal(dispatchTimeAllowed('2026-10-24T15:00:00Z',base),false);
 assert.equal(dispatchTimeAllowed('2026-10-21T15:00:00Z',{...base,skipHolidays:true,holidayDates:null}),false);
});
