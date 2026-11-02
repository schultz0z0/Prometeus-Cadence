import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {assistantActionAllowed,assistantInputSchema,parseAssistantOutput,todayItems,type AssistantFacts} from '../src/domain/assistant-actions.ts';
import {helpArticles,matchHelp} from '../src/domain/help-manifest.ts';

test('06F confirmation in chat never widens the user permission',()=>{
 assert.equal(assistantActionAllowed({requested:'cadences.publish',allowed:['data.write'],confirmed:true}),false);
 assert.equal(assistantActionAllowed({requested:'data.write',allowed:['data.write'],confirmed:false}),false);
 assert.equal(assistantActionAllowed({requested:'data.write',allowed:['data.write'],confirmed:true}),true);
 assert.equal(assistantActionAllowed({requested:'',allowed:[''],confirmed:true}),false);
});

test('help manifest answers from local articles with real app destinations',()=>{
 const settings=readFileSync('src/app/(app)/settings/[[...section]]/page.tsx','utf8');
 for(const a of helpArticles){
  const path=a.href.split('?')[0];assert.ok(a.body.length>40,a.id);
  // Every destination is a real page: settings sections live in the catch-all route.
  assert.ok(path.startsWith('/settings/')?settings.includes(`'${path.slice(10)}'`):existsSync(`src/app/(app)${path}/page.tsx`),a.href);
 }
 assert.equal(new Set(helpArticles.map(a=>a.id)).size,helpArticles.length);
 assert.equal(matchHelp('Como conecto meu Gmail?','/dashboard')[0].id,'email-connect');
 assert.equal(matchHelp('por que minha cadência não saiu hoje','/dashboard')[0].id,'cadence-not-sent');
 // Route context breaks ties toward the current area.
 assert.equal(matchHelp('como funciona','/settings/whatsapp')[0].id,'whatsapp-connect');
 assert.deepEqual(matchHelp('qwertyuiop zxcv','/dashboard'),[]);
});

test('assistant input and model output are bounded and citations must belong to the sources',()=>{
 assert.equal(assistantInputSchema.safeParse({text:'oi',contextRoute:'/dashboard',requestId:crypto.randomUUID()}).success,true);
 assert.equal(assistantInputSchema.safeParse({text:'x'.repeat(2001),contextRoute:'/dashboard',requestId:crypto.randomUUID()}).success,false);
 assert.equal(assistantInputSchema.safeParse({text:'oi',contextRoute:'https://evil.example',requestId:crypto.randomUUID()}).success,false);
 assert.equal(assistantInputSchema.safeParse({text:'   ',contextRoute:'/dashboard',requestId:crypto.randomUUID()}).success,false);
 const sources=[{kind:'help',id:'email-connect'},{kind:'fact',id:'channels'}];
 const out=parseAssistantOutput({text:'Conecte em Configurações.',citations:[{kind:'help',id:'email-connect'},{kind:'help',id:'invented'},{kind:'lead',id:'x'}]},sources);
 assert.deepEqual(out.citations,[{kind:'help',id:'email-connect'}]);
 assert.throws(()=>parseAssistantOutput({text:'',citations:[]},sources));
 assert.throws(()=>parseAssistantOutput({text:'ok',citations:[],extra:1},sources));
});

test('today card derives from objective account facts, at most one item',()=>{
 const base:AssistantFacts={leads:20,lists:1,emailReady:false,whatsappReady:false,cadencesActive:0,cadencesTotal:1,billing:'inactive'};
 assert.deepEqual(todayItems(base).map(i=>i.id),['channel']);
 assert.deepEqual(todayItems({...base,emailReady:true}).map(i=>i.id),['cadence-off']);
 assert.deepEqual(todayItems({...base,emailReady:true,cadencesActive:1}).map(i=>i.id),[]);
 assert.deepEqual(todayItems({...base,leads:0,lists:0,emailReady:true}).map(i=>i.id),['list']);
 assert.match(todayItems(base)[0].text,/20 leads/);
});
