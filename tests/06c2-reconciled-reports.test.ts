import test from 'node:test';import assert from 'node:assert/strict';
import {supportedMetric,reportRate,parseReportQuery,reportPeriodForDays,reportMetricDefinitions} from '../src/domain/reporting.ts';
test('unsupported telemetry remains null and invalid measured values cannot become counters',()=>{
 assert.equal(supportedMetric({supported:false,value:0}),null);assert.equal(supportedMetric({supported:true,value:0}),0);assert.equal(supportedMetric({supported:true,value:12}),12);
 for(const value of [NaN,Infinity,-1])assert.throws(()=>supportedMetric({supported:true,value}));
 assert.equal(reportRate(0,0),null);assert.equal(reportRate(1,4),25);assert.equal(reportRate(null,4),null);assert.equal(reportRate(4,3),null);
 assert.equal(reportMetricDefinitions.sent.unit,'unique-message');assert.equal(reportMetricDefinitions.replies.unit,'human-inbound-message');
});
test('report periods require absolute bounded instants and validate timezone filters',()=>{
 const query={view:'dashboard',from:'2026-10-01T00:00:00Z',to:'2026-10-29T00:00:00Z',timezone:'America/Sao_Paulo'};assert.equal(parseReportQuery(query).from,'2026-10-01T00:00:00.000Z');
 for(const change of [{from:'2026-10-01'},{to:query.from},{to:'2027-10-01T00:00:00Z'},{timezone:'invalid/zone'},{view:'arbitrary'},{secret:'no'}])assert.throws(()=>parseReportQuery({...query,...change}));
});
test('local calendar days handle DST forward/back and fixed offset sign correctly',()=>{
 assert.deepEqual(reportPeriodForDays(1,'America/New_York','2026-03-08T12:00:00Z'),{from:'2026-03-08T05:00:00.000Z',to:'2026-03-09T04:00:00.000Z',timezone:'America/New_York'});
 assert.deepEqual(reportPeriodForDays(1,'America/New_York','2026-11-01T12:00:00Z'),{from:'2026-11-01T04:00:00.000Z',to:'2026-11-02T05:00:00.000Z',timezone:'America/New_York'});
 assert.deepEqual(reportPeriodForDays(1,'+03:00','2026-10-29T00:30:00Z'),{from:'2026-10-28T21:00:00.000Z',to:'2026-10-29T21:00:00.000Z',timezone:'+03:00'});
 assert.throws(()=>reportPeriodForDays(0,'UTC'));assert.throws(()=>reportPeriodForDays(94,'UTC'));
});
