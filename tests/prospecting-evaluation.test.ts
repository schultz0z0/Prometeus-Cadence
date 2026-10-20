import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePredictions,validateEvaluationSet} from '../src/domain/prospecting-evaluation.ts';
test('evaluation reports exact classification abstention and incomplete cost',()=>{
  const gold=['fits','fits','does_not_fit','does_not_fit'].map((label,i)=>({id:String(i),companyId:String(i),domain:i+'.example',split:'test' as const,label:label as 'fits'|'does_not_fit'}));
  const predictions=['fits','does_not_fit','fits','insufficient_evidence'].map((verdict,i)=>({id:String(i),verdict:verdict as 'fits'|'does_not_fit'|'insufficient_evidence',costUsd:i===3?null:0.01,latencyMs:(i+1)*100,escalated:i===0}));
  const report=evaluatePredictions(gold,predictions);assert.equal(report.fits.precision,0.5);assert.equal(report.fits.recall,0.5);assert.equal(report.abstentionRate,0.25);assert.equal(report.coverage,0.75);assert.equal(report.hasUnknownCost,true);assert.equal(report.knownCostUsd,0.03);assert.equal(report.escalationRate,0.25);assert.equal(report.latencyMs.p95,400);
});
test('split leakage through domain or company and missing predictions are rejected',()=>{
  const row={id:'a',companyId:'one',domain:'www.example.com',split:'adjust' as const,label:'fits' as const};
  assert.throws(()=>validateEvaluationSet([row,{...row,id:'b',companyId:'two',domain:'example.com',split:'test'}]));
  assert.throws(()=>evaluatePredictions([row],[]));
});
