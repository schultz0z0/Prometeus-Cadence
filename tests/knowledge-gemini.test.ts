import test from 'node:test';import assert from 'node:assert/strict';
import {geminiEmbed,geminiTranscribePdf} from '../src/server/prospecting/ai/gemini.ts';
const env={GEMINI_API_KEY:'fixture-gemini-key'};
async function withEnv<T>(fn:()=>Promise<T>){const saved={...process.env};Object.assign(process.env,env);delete process.env.PLATFORM_AI_WORKSPACE_ID;try{return await fn();}finally{process.env=saved;}}
test('embeddings go in batches of 40 (under the 2 MB response cap) with the fixed model, size and task, normalized',()=>withEnv(async()=>{
 const calls:any[]=[];
 const r=await geminiEmbed(Array.from({length:250},(_,i)=>'texto '+i),'RETRIEVAL_DOCUMENT',AbortSignal.timeout(5000),async(url,init)=>{
  const body=JSON.parse(String(init!.body));calls.push({url:String(url),key:(init!.headers as any)['x-goog-api-key'],body});
  return Response.json({embeddings:body.requests.map(()=>({values:Array.from({length:1536},(_,i)=>i===0?3:i===1?4:0)}))});
 });
 assert.equal(calls.length,7);assert.deepEqual(calls.map(c=>c.body.requests.length),[40,40,40,40,40,40,10]);
 assert.match(calls[0].url,/models\/gemini-embedding-2:batchEmbedContents$/);assert.equal(calls[0].key,'fixture-gemini-key');
 assert.deepEqual({model:calls[0].body.requests[0].model,task:calls[0].body.requests[0].taskType,dim:calls[0].body.requests[0].outputDimensionality},{model:'models/gemini-embedding-2',task:'RETRIEVAL_DOCUMENT',dim:1536});
 assert.equal(r.vectors.length,250);assert.equal(r.vectors[0].length,1536);
 assert.ok(Math.abs(Math.hypot(...r.vectors[0])-1)<1e-9);assert.equal(r.vectors[0][0],0.6);
}));
test('a malformed embedding answer is a provider error',()=>withEnv(async()=>{
 await assert.rejects(geminiEmbed(['a'],'RETRIEVAL_QUERY',AbortSignal.timeout(5000),async()=>Response.json({embeddings:[{values:[1,2]}]})),(e:any)=>e.code==='GEMINI_EMBED_UNAVAILABLE');
 await assert.rejects(geminiEmbed(['a'],'RETRIEVAL_QUERY',AbortSignal.timeout(5000),async()=>Response.json({})),(e:any)=>e.code==='GEMINI_EMBED_UNAVAILABLE');
}));
test('pdf transcription sends the file inline to the generation model',()=>withEnv(async()=>{
 let sent:any=null;
 const r=await geminiTranscribePdf('gemini-fixture',new Uint8Array([37,80,68,70]),AbortSignal.timeout(5000),async(url,init)=>{sent={url:String(url),body:JSON.parse(String(init!.body))};
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Agente SDR R$ 900,00'}]}}],usageMetadata:{promptTokenCount:300,candidatesTokenCount:12}});});
 assert.match(sent.url,/models\/gemini-fixture:generateContent$/);
 const parts=sent.body.contents[0].parts;assert.equal(parts.find((p:any)=>p.inlineData).inlineData.mimeType,'application/pdf');assert.equal(parts.find((p:any)=>p.inlineData).inlineData.data,'JVBERg==');
 assert.equal(r.text,'Agente SDR R$ 900,00');assert.equal(r.inputTokens,300);
}));
test('a transcription cut by the output limit is refused, never kept as a partial document',()=>withEnv(async()=>{
 await assert.rejects(geminiTranscribePdf('gemini-fixture',new Uint8Array([37]),AbortSignal.timeout(5000),async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'primeiras páginas'}]}}]})),(e:any)=>e.code==='GEMINI_TRANSCRIBE_TRUNCATED');
}));
