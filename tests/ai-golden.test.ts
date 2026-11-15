import test from 'node:test';import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
// Locks the exact request each AI operation sends, so splitting the agents cannot change a prompt, schema or budget.
const dir='tests/fixtures/ai-golden/';
function golden(name:string,value:unknown){
 const file=dir+name+'.json',actual=JSON.parse(JSON.stringify(value));
 if(!existsSync(file)){if(process.env.UPDATE_GOLDEN!=='1')assert.fail('Missing golden '+file+' (run with UPDATE_GOLDEN=1 once, before changing code)');mkdirSync(dir,{recursive:true});writeFileSync(file,JSON.stringify(actual,null,1)+'\n');}
 assert.deepStrictEqual(actual,JSON.parse(readFileSync(file,'utf8')),name);
}
const evidence=[{id:'e1',url:'https://empresa.example',text:'Empresa de logística em Curitiba com 40 funcionários.',hash:'h',fetchedAt:'2026-11-14T00:00:00Z',truncated:false}];
const company={name:'Prometeus',offer:'Automações sob medida'},product={name:'Agente SDR',offer:'Atendimento no WhatsApp'};
test('qualify request',async()=>{
 const {conventionalPrompt,conventionalSchema}=await import('../src/server/prospecting/ai/output.ts');
 const input:any={task:'qualify',criteria:'Empresas de logística com mais de 20 pessoas',evidence,facts:{city:'Curitiba'},company,product,language:'pt-BR'};
 golden('prospecting-qualify',{prompt:conventionalPrompt(input),schema:conventionalSchema('qualify'),maxOutputTokens:4096});
});
test('decisors and company people requests',async()=>{
 const {decisorRequest,companyPeopleRequest}=await import('../src/server/prospecting/ai/decisors.ts');
 const input={company:{name:'Logística Exemplo',cnpj:'11222333000181'},knownNames:['Ana Silva'],evidence,context:company,product};
 golden('prospecting-decisors',decisorRequest(input));golden('prospecting-company-people',companyPeopleRequest(input));
});
test('planning request',async()=>{
 const {planningPrompt,planningJsonSchema}=await import('../src/server/planning/prompts.ts');
 const request:any={kind:'planning',task:'cadence_options',listId:'l1',objective:'Agendar diagnóstico',channels:['EMAIL','WHATSAPP'],tone:'direto',rhythm:'3 dias',highlight:'economia de tempo',avoid:'jargão',decisionMaker:'Sócio'};
 const sources=[{id:'s1',kind:'approved_context',url:null,text:'Prometeus cria automações.',hash:'h',obtainedAt:'2026-11-14T00:00:00Z'}] as any;
 golden('prospecting-planning',{prompt:planningPrompt({request,sources,context:company as any,product:product as any}),schema:planningJsonSchema('cadence_options'),maxOutputTokens:8192});
});
test('sdr turn request',async()=>{
 const {sdrPrompt,sdrOutputJsonSchema}=await import('../src/domain/sdr-turn.ts');const {defaultSdrDraft}=await import('../src/domain/sdr-policy.ts');
 golden('sdr-turn',{prompt:sdrPrompt({draft:{...defaultSdrDraft(),instructions:'Tom direto.',qualification:[{question:'Quantas pessoas?',field:'porte',required:false}]},context:company,knowledge:[{kind:'faq',title:'Preço',body:'Sob consulta'}],history:[{direction:'inbound',text:'oi'}],incoming:'quanto custa?',followup:null,meeting:null}),schema:sdrOutputJsonSchema,maxOutputTokens:4096});
});
test('assistant request',async()=>{
 const {assistantPrompt}=await import('../src/server/assistant/service.ts');const {assistantOutputJsonSchema}=await import('../src/domain/assistant-actions.ts');const {matchHelp}=await import('../src/domain/help-manifest.ts');
 const facts={leads:10,lists:2,emailReady:true,whatsappReady:true,cadencesActive:1,cadencesTotal:3,billing:'Pro'};
 golden('assistant-answer',{prompt:assistantPrompt({question:'Como crio uma cadência?',route:'/cadences',facts,articles:matchHelp('Como crio uma cadência?','/cadences'),history:[{role:'user',text:'oi'}],catalog:{lists:[{id:'l1',name:'Logística',leads:10}],conversations:[]}}),schema:assistantOutputJsonSchema,maxOutputTokens:4096});
});
const env={PLATFORM_AI_WORKSPACE_ID:'w',PROSPECTING_ENABLED:'true',CADENCE_RUNTIME_MODE:'local',BETTER_AUTH_URL:'http://127.0.0.1:3210',OPENAI_API_KEY:'private-fixture',OPENAI_MODEL:'fixture',GEMINI_API_KEY:'private-fixture',GEMINI_MODEL:'gemini-fixture'};
async function withEnv<T>(fn:()=>Promise<T>){const saved={...process.env};Object.assign(process.env,env);try{return await fn();}finally{process.env=saved;}}
test('linkedin comment request on the wire',()=>withEnv(async()=>{
 const {conventionalConfig}=await import('../src/server/prospecting/ai/config.ts');const {generateCommentWithRoute}=await import('../src/server/linkedin/comment-ai.ts');
 let sent:any=null;
 await generateCommentWithRoute(conventionalConfig('w').conventional.openai.route,{workspaceId:'w',runId:'r',postText:'Logística no Brasil',guidance:'Concorde',person:{name:'Ana',headline:'CEO',company:'Exemplo'}},{fetcher:async(url,init)=>{sent={url:String(url),body:JSON.parse(String(init!.body))};
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({comment:'Bom ponto.'})}]}],usage:{input_tokens:5,output_tokens:3}});}});
 golden('linkedin-comment-wire',sent);
}));
test('gemini request on the wire',()=>withEnv(async()=>{
 const {conventionalConfig}=await import('../src/server/prospecting/ai/config.ts');const {runConventionalJson}=await import('../src/server/prospecting/ai/json.ts');
 const route=conventionalConfig('w').conventional.gemini.route;let sent:any=null;
 const ctx:any={operationId:'op',workspaceId:'w',signal:AbortSignal.timeout(5000),route,agent:'sdr',operation:'sdr-turn'};
 const r=await runConventionalJson(ctx,{prompt:'p',schema:{type:'object'},maxOutputTokens:4096,parse:v=>v},{fetcher:async(url,init)=>{sent={url:String(url),body:JSON.parse(String(init!.body))};
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"ok":true}'}]}}],usageMetadata:{promptTokenCount:2,candidatesTokenCount:1}});}});
 golden('gemini-wire',{sent,route:{provider:route.provider,model:route.model,configFingerprint:route.configFingerprint},value:r.value});
}));
