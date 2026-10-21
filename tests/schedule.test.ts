import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleV2Schema,wallTimeToUtc,nextOccurrence,latestDueWindow,type ScheduleV2} from '../src/domain/schedule.ts';
const daily:ScheduleV2={frequency:'daily',time:'07:00',timezone:'America/Sao_Paulo',weekdays:[1,2,3,4,5],anchorDate:'2026-10-20'};
test('wall clock conversion uses the requested zone and resolves gap and fold to their first valid instant',()=>{
 assert.equal(wallTimeToUtc('2026-10-20','07:00','America/Sao_Paulo'),'2026-10-20T10:00:00.000Z');
 assert.equal(wallTimeToUtc('2026-03-08','02:30','America/New_York'),'2026-03-08T07:00:00.000Z');
 assert.equal(wallTimeToUtc('2026-11-01','01:30','America/New_York'),'2026-11-01T05:30:00.000Z');
 assert.equal(wallTimeToUtc('2026-10-04','02:15','Australia/Lord_Howe'),'2026-10-03T15:30:00.000Z');
});
test('daily weekdays and exclusive boundaries do not repeat a folded local time',()=>{
 assert.equal(nextOccurrence(daily,'2026-10-23T10:00:00.000Z'),'2026-10-26T10:00:00.000Z');
 const ny={...daily,anchorDate:'2026-03-01',time:'07:00',timezone:'America/New_York',weekdays:[0,1,2,3,4,5,6]};
 assert.equal(nextOccurrence(ny,'2026-03-07T12:00:00.000Z'),'2026-03-08T11:00:00.000Z');
 assert.equal(nextOccurrence({...ny,time:'01:30'},'2026-11-01T05:30:00.000Z'),'2026-11-02T06:30:00.000Z');
});
test('anchor dates control once biweekly custom and monthly clamp including leap years',()=>{
 assert.equal(nextOccurrence({...daily,frequency:'monthly',time:'07:00',timezone:'UTC',weekdays:[],anchorDate:'2027-01-31',monthDay:31},'2027-02-01T00:00:00.000Z'),'2027-02-28T07:00:00.000Z');
 assert.equal(nextOccurrence({...daily,frequency:'monthly',timezone:'UTC',anchorDate:'2028-01-31',monthDay:31},'2028-02-01T00:00:00.000Z'),'2028-02-29T07:00:00.000Z');
 assert.equal(nextOccurrence({...daily,frequency:'biweekly',timezone:'UTC',weekdays:[]},'2026-10-20T07:00:00.000Z'),'2026-11-03T07:00:00.000Z');
 assert.equal(nextOccurrence({...daily,frequency:'custom',intervalDays:3,timezone:'UTC'},'2026-10-22T00:00:00.000Z'),'2026-10-23T07:00:00.000Z');
 assert.equal(nextOccurrence({...daily,frequency:'once',timezone:'UTC'},'2026-10-20T07:00:00.000Z'),null);
 assert.equal(nextOccurrence({...daily,frequency:'once',timezone:'UTC'},'2026-10-19T00:00:00.000Z'),'2026-10-20T07:00:00.000Z');
});
test('outage recovery emits only the latest due occurrence with an exact omitted count',()=>{
 assert.deepEqual(latestDueWindow(daily,'2026-10-20T10:00:00.000Z','2026-10-26T11:00:00.000Z'),{scheduledAt:'2026-10-26T10:00:00.000Z',nextRunAt:'2026-10-27T10:00:00.000Z',skipped:4});
 assert.equal(latestDueWindow(daily,'2026-10-20T10:00:00.000Z','2026-10-20T09:59:00.000Z'),null);
 const monthly={...daily,frequency:'monthly' as const,timezone:'UTC',anchorDate:'2027-01-31',monthDay:31};
 assert.deepEqual(latestDueWindow(monthly,'2027-01-31T07:00:00.000Z','2027-04-30T10:00:00.000Z'),{scheduledAt:'2027-04-30T07:00:00.000Z',nextRunAt:'2027-05-31T07:00:00.000Z',skipped:3});
 assert.deepEqual(latestDueWindow({...daily,frequency:'once',timezone:'UTC'},'2026-10-20T07:00:00.000Z','2026-12-01T00:00:00.000Z'),{scheduledAt:'2026-10-20T07:00:00.000Z',nextRunAt:null,skipped:0});
});
test('legacy incomplete calendars unknown fields and invalid dates never authorize a recurrence',()=>{
 for(const change of [{weekdays:[]},{weekdays:[1,1]},{timezone:'invalid'},{time:'25:00'},{anchorDate:'2026-02-30'},{anchorDate:undefined},{frequency:'custom',intervalDays:0},{frequency:'monthly',monthDay:32},{cron:'* * * * *'}])assert.equal(scheduleV2Schema.safeParse({...daily,...change}).success,false);
 assert.throws(()=>wallTimeToUtc('2026-02-30','12:00','UTC'));
 assert.throws(()=>wallTimeToUtc('2026-10-20','24:01','UTC'));
});
