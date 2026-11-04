import test from'node:test';import assert from'node:assert/strict';
import{sequenceDraftSchema,pickCommentPost,commentOutputSchema}from'../src/domain/linkedin-sequence.ts';
import{approveSchema}from'../src/domain/linkedin-approval.ts';
const id='0f7c2a51-1d3b-4f0e-9a51-6b8f1c2d3e4f';
test('07A.3c a sequence step is a message or a comment on the latest post',()=>{
 assert.ok(sequenceDraftSchema.safeParse({name:'x',campaignId:id,steps:[{kind:'comment',delayDays:0,guidance:'tom curioso'},{delayDays:2,body:'Oi, {nome}'}]}).success);
 assert.ok(sequenceDraftSchema.safeParse({name:'x',campaignId:id,steps:[{kind:'comment',delayDays:0}]}).success,'guidance is optional');
 assert.equal(sequenceDraftSchema.safeParse({name:'x',campaignId:id,steps:[{kind:'comment',delayDays:0,body:'x'}]}).success,false,'a comment step has no fixed text');
 assert.equal(sequenceDraftSchema.safeParse({name:'x',campaignId:id,steps:[{kind:'comment',delayDays:0,guidance:'a'.repeat(301)}]}).success,false);
});
test('07A.3c the post to comment: own, recent, with text, open to comments',()=>{
 const now=Date.parse('2026-11-04T12:00:00Z'),d=(days:number)=>new Date(now-days*864e5).toISOString();
 const post=(o:Record<string,unknown>)=>({social_id:'urn:li:activity:1',text:'Um texto',parsed_datetime:d(1),share_url:'https://www.linkedin.com/posts/x',is_repost:false,permissions:{can_post_comments:true},...o});
 assert.equal(pickCommentPost([post({social_id:'a',is_repost:true}),post({social_id:'b',text:''}),post({social_id:'c',permissions:{can_post_comments:false}}),post({social_id:'d',parsed_datetime:d(31)}),post({social_id:'e',parsed_datetime:d(3)}),post({social_id:'f',parsed_datetime:d(2)})],now)?.socialId,'f');
 assert.equal(pickCommentPost([post({parsed_datetime:d(40)})],now),null);
 assert.equal(pickCommentPost('nope' as never,now),null);
});
test('07A.3c AI comment output and the approval input',()=>{
 assert.ok(commentOutputSchema.safeParse({comment:'Ótimo ponto sobre logística.'}).success);
 for(const comment of ['','a'.repeat(601),'Veja https://exemplo.com','Vamos marcar uma reunião?'])assert.equal(commentOutputSchema.safeParse({comment}).success,false,comment.slice(0,20));
 assert.ok(approveSchema.safeParse({body:'Texto',expectedRevision:1,requestId:id}).success);
 assert.equal(approveSchema.safeParse({body:'a'.repeat(1251),expectedRevision:1,requestId:id}).success,false);
});
