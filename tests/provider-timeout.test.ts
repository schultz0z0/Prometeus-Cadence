import test from 'node:test';import assert from 'node:assert/strict';
// 16/11/2026: thinking models answer in more than 30 s; a generation cut at 30 s became an uncertain "NETWORK" step.
const ok=()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]});
async function timeoutsOf(t:any,fn:()=>Promise<unknown>){const seen:number[]=[],real=AbortSignal.timeout.bind(AbortSignal);
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{seen.push(ms);return real(ms);});await fn();return seen;}
test('a Gemini generation waits up to 120 s',async t=>{
 process.env.GEMINI_API_KEY??='private-fixture';const {geminiJson}=await import('../src/server/prospecting/ai/gemini.ts');
 assert.deepEqual(await timeoutsOf(t,()=>geminiJson('gemini-fixture','p',{},AbortSignal.timeout(999999),async()=>ok())),[999999,120000]);
});
test('other provider calls keep the 30 s limit',async t=>{
 const {providerJson}=await import('../src/server/prospecting/providers/transport.ts');
 assert.deepEqual(await timeoutsOf(t,()=>providerJson(async()=>Response.json({}),'https://x.example',{method:'POST'},new AbortController().signal)),[30000]);
});
