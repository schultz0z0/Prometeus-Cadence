import test from 'node:test';import assert from 'node:assert/strict';
import {sdrReminderTimes,sdrReminderText,firstName} from '../src/domain/sdr-reminder.ts';
import {timezoneLabel} from '../src/domain/sdr-stage.ts';
// 16/11/2026: meeting reminders (day before and 2h before), app-written text.
const H={timezone:'America/Sao_Paulo',weekdays:[1,2,3,4,5],start:'09:00',end:'18:00',allDay:false};
const BR=timezoneLabel('America/Sao_Paulo');
// Wed 18/11 15:30 BRT, booked Mon 16/11
test('day before at 09:00 and 2h before',()=>assert.deepEqual(sdrReminderTimes({start:'2026-11-18T18:30:00.000Z',bookedAt:'2026-11-16T14:00:00.000Z',hours:H}),
 [{kind:'day-before',at:'2026-11-17T12:00:00.000Z'},{kind:'two-hours',at:'2026-11-18T16:30:00.000Z'}]));
// Wed 18/11 10:00 BRT: 2h before is 08:00, outside 09–18
test('2h reminder outside agent hours is skipped',()=>assert.deepEqual(sdrReminderTimes({start:'2026-11-18T13:00:00.000Z',bookedAt:'2026-11-16T14:00:00.000Z',hours:H}).map(x=>x.kind),['day-before']));
test('same-day booking gets only the 2h reminder',()=>assert.deepEqual(sdrReminderTimes({start:'2026-11-16T18:30:00.000Z',bookedAt:'2026-11-16T14:05:00.000Z',hours:H}),[{kind:'two-hours',at:'2026-11-16T16:30:00.000Z'}]));
test('a booking less than 3h ahead gets no reminder',()=>assert.deepEqual(sdrReminderTimes({start:'2026-11-16T18:30:00.000Z',bookedAt:'2026-11-16T15:50:00.000Z',hours:H}),[]));
test('a closed day before means no day-before reminder',()=>assert.deepEqual(sdrReminderTimes({start:'2026-11-23T18:30:00.000Z',bookedAt:'2026-11-16T14:00:00.000Z',hours:H}).map(x=>x.kind),['two-hours']));
test('day before starts at the agent opening when later than 09:00',()=>assert.equal(sdrReminderTimes({start:'2026-11-18T18:30:00.000Z',bookedAt:'2026-11-16T14:00:00.000Z',hours:{...H,start:'10:00'}})[0].at,'2026-11-17T13:00:00.000Z'));
test('all-day agents use 09:00 and start minus 2h',()=>assert.deepEqual(sdrReminderTimes({start:'2026-11-18T13:00:00.000Z',bookedAt:'2026-11-16T14:00:00.000Z',hours:{...H,allDay:true,weekdays:[0,1,2,3,4,5,6]}}),
 [{kind:'day-before',at:'2026-11-17T12:00:00.000Z'},{kind:'two-hours',at:'2026-11-18T11:00:00.000Z'}]));
const base={start:'2026-11-16T18:30:00.000Z',timezone:'America/Sao_Paulo',meetUrl:'https://meet.google.com/ziy-npok-ece'};
test('2h reminder after a confirmation brings the link and says Te espero lá',()=>assert.equal(sdrReminderText({...base,kind:'two-hours',name:'Raphael teste',confirmed:true}),
 `Oi, Raphael! Nossa reunião é hoje às 15:30 (${BR}). O link do Google Meet é https://meet.google.com/ziy-npok-ece e também está no convite do seu e-mail. Te espero lá!`));
test('2h reminder without confirmation asks again',()=>assert.match(sdrReminderText({...base,kind:'two-hours',name:'Raphael',confirmed:false}),/convite do seu e-mail\. Segue de pé\?$/));
test('2h reminder without a Meet link has no link sentence',()=>assert.equal(sdrReminderText({...base,meetUrl:null,kind:'two-hours',name:'Ana',confirmed:false}),`Oi, Ana! Nossa reunião é hoje às 15:30 (${BR}). Segue de pé?`));
test('a phone number as name greets without a name',()=>assert.match(sdrReminderText({...base,kind:'two-hours',name:'+5521964342764',confirmed:false}),/^Oi! Nossa reunião/));
test('day-before text',()=>assert.equal(sdrReminderText({...base,start:'2026-11-17T12:00:00.000Z',kind:'day-before',name:'Raphael',confirmed:false}),
 `Oi, Raphael! Passando para confirmar nossa reunião amanhã, terça, 17/11, às 09:00 (${BR}), pelo Google Meet. Segue de pé? Se precisar, te ofereço outro horário.`));
test('first name',()=>{assert.equal(firstName(' Raphael Schultz '),'Raphael');assert.equal(firstName(''),null);assert.equal(firstName(null),null);assert.equal(firstName('(21) 96434-2764'),null);});
