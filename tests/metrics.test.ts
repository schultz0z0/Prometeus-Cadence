import test from 'node:test';import assert from 'node:assert/strict';
import {calculateMetrics} from '../src/domain/metrics.ts';import {createSeed} from '../src/demo/seed.ts';
test('dashboard and funnel use the same qualified count and handle absent email',()=>{const s=createSeed();s.leads=s.leads.slice(0,3);s.leads[0].email=undefined;s.leads[2].qualification='pending';const m=calculateMetrics(s);assert.equal(m.total,3);assert.equal(m.qualified,2);assert.equal(m.funnel.qualified,2);assert.equal(m.pending,1);assert.equal(m.sent,0);});
