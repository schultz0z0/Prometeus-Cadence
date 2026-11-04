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

test('07A.3c the platform AI request is accepted by the conventional runner',async()=>{
 const saved={...process.env};Object.assign(process.env,{PLATFORM_AI_WORKSPACE_ID:'w',PROSPECTING_ENABLED:'true',CADENCE_RUNTIME_MODE:'local',BETTER_AUTH_URL:'http://127.0.0.1:3210',OPENAI_API_KEY:'private-fixture',OPENAI_MODEL:'fixture'});
 try{const {conventionalConfig}=await import('../src/server/prospecting/ai/config.ts');const {generateCommentWithRoute}=await import('../src/server/linkedin/comment-ai.ts');
  const route=conventionalConfig('w').conventional.openai.route;let prompt='';
  const r=await generateCommentWithRoute(route,{workspaceId:'w',runId:'r',postText:'[RE] Logística',guidance:null,person:{name:'[RE] Ana',headline:null,company:null}},{fetcher:async(_u,init)=>{prompt=String(init!.body);
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({comment:'[RE] Bom ponto.'})}]}],usage:{input_tokens:5,output_tokens:3}});}});
  assert.equal(r.text,'[RE] Bom ponto.');assert.ok(prompt.includes('[RE] Logística'));
 }finally{process.env=saved;}
});
