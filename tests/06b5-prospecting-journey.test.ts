import test from 'node:test';
import assert from 'node:assert/strict';
import {journeyInputSchema,nextJourneyStage,journeyRetryIds} from '../src/domain/prospecting-journey.ts';

test('partial research retains useful qualification for review and never approves a cadence',()=>{
 assert.equal(nextJourneyStage({research:'partial',qualification:'completed',cadenceApproved:false}),'review');
 assert.equal(nextJourneyStage({research:'completed',qualification:'pending',cadenceApproved:false}),'qualify');
 assert.equal(nextJourneyStage({research:'running',qualification:'pending',cadenceApproved:false}),'research');
 assert.equal(nextJourneyStage({research:'completed',qualification:'completed',cadenceApproved:true}),'ready');
});
test('journey rejects missing purpose, location, excess or fractional company count and unknown fields',()=>{
 for(const v of [{brief:'',location:'Rio',limit:1},{brief:'Clínicas',location:'',limit:1},{brief:'Clínicas',location:'Rio',limit:501},{brief:'Clínicas',location:'Rio',limit:1.5},{brief:'Clínicas',location:'Rio',limit:0},{brief:'Clínicas',location:'Rio',limit:1,actorId:'forged'}])assert.equal(journeyInputSchema.safeParse(v).success,false);
 assert.deepEqual(journeyInputSchema.parse({brief:'  Clínicas  ',location:' Rio ',limit:500}),{brief:'Clínicas',location:'Rio',limit:500});
});
test('retry excludes all useful companies and never retries uncertain effects',()=>{
 assert.deepEqual(journeyRetryIds([{leadId:'a',state:'completed'},{leadId:'b',state:'partial'},{leadId:'c',state:'failed'},{leadId:'a',state:'failed'}]),['b','c']);
 assert.deepEqual(journeyRetryIds([{leadId:'a',state:'needs_reconciliation'},{leadId:'b',state:'running'}]),[]);
});
