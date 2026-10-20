import test from 'node:test';
import assert from 'node:assert/strict';
import { jobInputSchema } from '../src/server/prospecting/schemas.ts';
import { createReviewToken, verifyReviewToken } from '../src/server/prospecting/review.ts';
const input = {kind:'generation',source:'MAPS',destination:{mode:'new',name:'Dentistas'},filters:{term:'dentistas',location:'São Paulo'},limit:10,dedupScope:'workspace'};
const proof = {userId:'a',workspaceId:'w',input,revision:2,profileVersion:'v1'};
test('review proof binds actor workspace input revision profile and expiration', () => {
  const token=createReviewToken(proof,'test-secret',1000);
  assert.doesNotThrow(()=>verifyReviewToken(token,proof,'test-secret',1001));
  for(const changed of [{...proof,userId:'b'},{...proof,workspaceId:'other'},{...proof,input:{...input,limit:11}},{...proof,revision:3},{...proof,profileVersion:'v2'}])
    assert.throws(()=>verifyReviewToken(token,changed,'test-secret',1001));
  assert.throws(()=>verifyReviewToken(token,proof,'wrong-secret',1001));
  assert.throws(()=>verifyReviewToken(token,proof,'test-secret',601001));
  assert.throws(()=>verifyReviewToken(token+'x',proof,'test-secret',1001));
});
test('prospecting input rejects oversized batches unknown filters and unsupported modules', () => {
  assert.equal(jobInputSchema.safeParse(input).success,true);
  for(const invalid of [{...input,limit:501},{...input,filters:{...input.filters,actorId:'attacker'}},{...input,destination:{mode:'new',name:''}},{kind:'qualification',listId:'l',leadIds:['x'],modules:['validateWhatsapp'],summaryPolicy:'all',escalation:'off'}])
    assert.equal(jobInputSchema.safeParse(invalid).success,false);
});
