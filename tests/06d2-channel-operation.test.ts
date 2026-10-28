import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDeliveryProof} from '../src/domain/channel-evidence.ts';

test('provider acceptance never implies delivery or reading without a receipt',()=>{
 for(const [input,want] of [
  [{accepted:false,delivered:null,read:null},'pending'],
  [{accepted:true,delivered:null,read:null},'accepted'],
  [{accepted:true,delivered:false,read:false},'accepted'],
  [{accepted:false,delivered:true,read:null},'delivered'],
  [{accepted:false,delivered:null,read:true},'read'],
  [{accepted:true,delivered:true,read:true},'read'],
 ] as const)assert.equal(classifyDeliveryProof(input),want);
});
