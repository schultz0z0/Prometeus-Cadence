import test from 'node:test';
import assert from 'node:assert/strict';
import {decide} from '../src/server/prospecting/ai/jev.ts';
import {generate,buildCodexInvocation} from '../src/server/prospecting/ai/codex.ts';
import {writeFile} from 'node:fs/promises';
import {suggestedQualification} from '../src/server/prospecting/ai/policy.ts';
const evidence=[{id:'e1',url:'https://example.com',text:'Somos uma clínica odontológica em São Paulo.',hash:'h',fetchedAt:new Date().toISOString(),truncated:false}];
const ctx={operationId:'op',signal:new AbortController().signal,credential:'fixture-secret'};
test('JEV uses decisions contract and missing confidence stays unknown',async()=>{
  let sent:any,url='';
  const decision=await decide({...ctx,fetcher:async(u,i)=>{url=String(u);sent=JSON.parse(i!.body as string);return Response.json({answers:{fit:{type:'choice',choice:'fits'},quality:{type:'noul',noul:0.8},coverage:{type:'score',score:2}}});}},{criteria:'Clínicas',evidence,facts:{}});
  assert.equal(url,'https://openrouter.ai/api/alpha/decisions');assert.equal(sent.model,'typesafe/jev-1.13');assert.ok(sent.state);assert.ok(sent.questions.fit);
  assert.equal(decision.confidence,null);assert.equal(decision.verdict,'fits');assert.equal(decision.criteria.quality,0.8);assert.equal(decision.usage.costUsd,null);
  let calls=0;
  const empty=await decide({...ctx,fetcher:async()=>{calls++;throw Error();}},{criteria:'Clínicas',evidence:[],facts:{}});
  assert.equal(empty.verdict,'insufficient_evidence');assert.equal(calls,0);
});
test('invalid decision labels and probability distributions are rejected',async()=>{
  for(const fit of[{type:'choice',choice:'yes'},{type:'choice',choice:'fits',confidence:1.5},{type:'choice',choice:'fits',probabilities:{fits:2}}])await assert.rejects(()=>decide({...ctx,fetcher:async()=>Response.json({answers:{fit}})},{criteria:'x',evidence,facts:{}}));
});
test('high choice confidence cannot qualify zero-quality or uncovered company evidence',async()=>{
  const decision=await decide({...ctx,fetcher:async()=>Response.json({answers:{fit:{type:'choice',choice:'fits',confidence:0.99},quality:{type:'noul',noul:0},coverage:{type:'score',score:0}}})},{criteria:'Clínicas',evidence,facts:{}});
  assert.equal(suggestedQualification(decision),'pending');assert.equal(decision.verdict,'insufficient_evidence');
});
test('an invalid successful JEV response remains billable-uncertain',async()=>{
  await assert.rejects(()=>decide({...ctx,fetcher:async()=>Response.json({answers:{fit:{choice:'unrecognized'}}})},{criteria:'x',evidence,facts:{}}),(error:any)=>error.uncertain===true);
});
test('Codex rejects hosted or unapproved workspaces before starting and uses secret-free argv',async()=>{
  let calls=0;
  await assert.rejects(()=>generate({operationId:'op',signal:ctx.signal,workspaceId:'w',run:async()=>{calls++;return ''; }},{task:'summary',evidence,criteria:'x'}));assert.equal(calls,0);
  const invocation=buildCodexInvocation({binary:'C:/bin/codex.exe',model:'model',cwd:'C:/temp/qa',schemaPath:'C:/temp/qa/schema.json',outputPath:'C:/temp/qa/output.json'});
  assert.equal(invocation.shell,false);assert.ok(invocation.args.includes('--ignore-user-config'));assert.equal(Object.hasOwn(invocation.env,'OPENROUTER_API_KEY'),false);assert.equal(Object.hasOwn(invocation.env,'MIGRATOR_DATABASE_URL'),false);
});

test('Codex invocation uses only feature switches supported by the pinned runtime',()=>{
  const invocation=buildCodexInvocation({binary:'codex.exe',model:'model',cwd:'qa',schemaPath:'schema.json',outputPath:'output.json'});
  const known=new Set(['shell_tool','unified_exec','apps','hooks','plugins','remote_plugin','browser_use','browser_use_external','computer_use','multi_agent','code_mode_host','view_image','goals','skill_search','tool_suggest','sleep_tool','skip_host_skill_discovery']);
  for(let i=0;i<invocation.args.length;i++)if(['--disable','--enable'].includes(invocation.args[i]))assert.ok(known.has(invocation.args[i+1]),'Unsupported runtime feature: '+invocation.args[i+1]);
});

test('Codex validates cited JSON output and releases its cross-process slot after failure',async()=>{
  const keys=['PLATFORM_AI_WORKSPACE_ID','PROSPECTING_ENABLED','CADENCE_RUNTIME_MODE','BETTER_AUTH_URL','CODEX_LOCAL_ENABLED','CODEX_BINARY','CODEX_MODEL','CODEX_TEST_WORKSPACE_IDS'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{PLATFORM_AI_WORKSPACE_ID:'w',PROSPECTING_ENABLED:'true',CADENCE_RUNTIME_MODE:'local',BETTER_AUTH_URL:'http://127.0.0.1:3210',CODEX_LOCAL_ENABLED:'true',CODEX_BINARY:process.execPath,CODEX_MODEL:'test-model',CODEX_TEST_WORKSPACE_IDS:'w'});
  let releases=0;
  const context={operationId:'op',workspaceId:'w',signal:ctx.signal,acquireSlot:async()=>true,releaseSlot:async()=>{releases++;}};
  try{
    const result=await generate({...context,run:async(invocation,input)=>{
      assert.equal(invocation.shell,false);assert.ok(input.includes('untrustedEvidence'));assert.ok(invocation.args.includes('skip_host_skill_discovery'));
      await writeFile(invocation.args[invocation.args.indexOf('--output-last-message')+1],JSON.stringify({summary:'Clínica odontológica.',evidenceIds:['e1']}));return '{"type":"turn.completed"}\n';
    }},{task:'summary',evidence,criteria:'Clínicas'});
    assert.equal(result.summary,'Clínica odontológica.');assert.equal(result.usage.costUsd,null);
    await assert.rejects(()=>generate({...context,run:async()=>'{"item_type":"command_execution"}'},{task:'summary',evidence,criteria:'x'}),/UNEXPECTED_TOOL/);
    assert.equal(releases,2);
    process.env.CADENCE_RUNTIME_MODE='hosted';
    await assert.rejects(()=>generate({...context,run:async()=>{throw Error('should not start');}},{task:'summary',evidence,criteria:'x'}),/UNAVAILABLE/);
  }finally{for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
