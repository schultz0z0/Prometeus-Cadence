import test from 'node:test';
import assert from 'node:assert/strict';
import {groupUsageEstimates} from '../src/domain/prospecting.ts';
test('review combines duplicate provider units and keeps unknown costs unknown',()=>{
 const row={provider:'apify',unit:'apifyRuns' as const,maxUnits:1,estimatedUsd:null,pricingSource:null};
 assert.deepEqual(groupUsageEstimates([row,{...row,maxUnits:2}, {...row,provider:'other'}]),[
  {...row,maxUnits:3},{...row,provider:'other'},
 ]);
 assert.equal(groupUsageEstimates([{...row,estimatedUsd:1},row])[0].estimatedUsd,null);
});
