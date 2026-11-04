import test from 'node:test';
import assert from 'node:assert/strict';
import {PIPELINE_COLUMNS,pipelineStage,canMoveStage,replyInputSchema,REPLY_WINDOW_MS} from '../src/domain/linkedin-message-action.ts';

test('07A.3 pipeline columns follow the reference and stages come from real states',()=>{
 assert.deepEqual(PIPELINE_COLUMNS.map(c=>c[1]),['Na fila','Aquecida','Convidada','Aceitou','Respondeu']);
 assert.equal(pipelineStage({state:'queued',repliedAt:null,stageOverride:null}),'queued');
 assert.equal(pipelineStage({state:'sending',repliedAt:null,stageOverride:null}),'queued');
 assert.equal(pipelineStage({state:'uncertain',repliedAt:null,stageOverride:null}),'invited');
 assert.equal(pipelineStage({state:'accepted',repliedAt:null,stageOverride:null}),'accepted');
 assert.equal(pipelineStage({state:'accepted',repliedAt:'2026-11-04T12:00:00Z',stageOverride:null}),'replied','a real reply moves the person');
 assert.equal(pipelineStage({state:'accepted',repliedAt:null,stageOverride:'replied'}),'replied','a manual mark for a reply outside LinkedIn');
 assert.equal(pipelineStage({state:'accepted',repliedAt:'2026-11-04T12:00:00Z',stageOverride:'accepted'}),'replied','a real reply is never hidden by a manual move');
 for(const s of ['expired','skipped','failed'])assert.equal(pipelineStage({state:s,repliedAt:null,stageOverride:null}),null);
});

test('07A.3 only the after-accept stages move by hand',()=>{
 assert.equal(canMoveStage('accepted','replied'),true);
 assert.equal(canMoveStage('replied','accepted'),true);
 assert.equal(canMoveStage('queued','invited'),false,'an invite is never faked');
 assert.equal(canMoveStage('invited','accepted'),false,'an acceptance is never faked');
 assert.equal(canMoveStage('accepted','warming'),false);
});

test('07A.3 replies are reviewed text sent within a minute of the review',()=>{
 assert.equal(REPLY_WINDOW_MS,60000);
 assert.equal(replyInputSchema.safeParse({threadId:crypto.randomUUID(),body:'  '}).success,false);
 assert.equal(replyInputSchema.safeParse({threadId:crypto.randomUUID(),body:'x'.repeat(8001)}).success,false);
 assert.equal(replyInputSchema.safeParse({threadId:crypto.randomUUID(),body:'Oi!',extra:1}).success,false);
 assert.equal(replyInputSchema.safeParse({threadId:crypto.randomUUID(),body:'Oi!'}).success,true);
});
