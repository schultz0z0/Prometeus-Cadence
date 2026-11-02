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
 // Verb forms match by stem: 'qualifica' finds the qualifier even on the contacts page.
 assert.equal(matchHelp('Qualifica a lista de clínicas pra mim','/contacts')[0].id,'qualifier');
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

test('06F.2 closed command allowlist: payloads are bounded, references must come from the supplied catalog, permissions map per kind',async()=>{
 const {commandSchemas,commandPermission,parseProposal}=await import('../src/domain/assistant-actions.ts');
 assert.deepEqual(Object.keys(commandSchemas).sort(),['create-audience-automation','create-cadence','draft-reply','qualify-list']);
 const catalog={lists:['l1'],conversations:['c1']};
 assert.deepEqual(parseProposal({kind:'qualify-list',payload:{listId:'l1'}},catalog),{kind:'qualify-list',payload:{listId:'l1'}});
 assert.equal(parseProposal({kind:'qualify-list',payload:{listId:'other-ws'}},catalog),null);
 assert.equal(parseProposal({kind:'cadences.publish',payload:{}},catalog),null);
 assert.equal(parseProposal({kind:'draft-reply',payload:{conversationId:'c1',text:'x'.repeat(4001)}},catalog),null);
 assert.equal(parseProposal({kind:'create-audience-automation',payload:{description:'Clínicas em SP',channel:'email',activate:true}},catalog),null);
 assert.ok(parseProposal({kind:'create-cadence',payload:{listId:'l1',objective:'Agendar reunião',channels:['EMAIL'],tone:'Consultivo'}},catalog));
 assert.equal(parseProposal(null,catalog),null);
 assert.equal(commandPermission['draft-reply'],'messages.reply');
 for(const k of Object.keys(commandSchemas))assert.equal(assistantActionAllowed({requested:commandPermission[k as keyof typeof commandPermission],allowed:['data.write','messages.reply'],confirmed:true}),true);
});

test('06F.2 route tours: every tour has steps, the shell maps routes to tours, and progress ids are a closed list',async()=>{
 const {routeTours,tourForRoute,tourIds}=await import('../src/domain/route-tours.ts');
 assert.ok(routeTours.length>=8);for(const t of routeTours){assert.ok(t.steps.length>=3,t.id);assert.ok(t.steps.every(s=>s.title&&s.body.length>20),t.id);}
 assert.equal(tourForRoute('/contacts').id,'contacts');assert.equal(tourForRoute('/cadences/abc').id,'cadences');assert.equal(tourForRoute('/settings/email').id,'settings');
 assert.equal(tourForRoute('/rota-inexistente').id,'overview');
 assert.deepEqual([...tourIds].sort(),routeTours.map(t=>t.id).sort());
});

test('06F.2 inherited minors: research batch honors ?leadId and a later successful poll clears only the load error',()=>{
 const research=readFileSync('src/modules/research/company-research.tsx','utf8'),evidence=readFileSync('src/modules/messages/delivery-details.tsx','utf8');
 assert.match(research,/export function ResearchResults[\s\S]{0,400}get\('leadId'\)/);
 assert.match(evidence,/setEvidence\(value\);setLoadError\(''\)/);assert.doesNotMatch(evidence,/setEvidence\(value\);setError\(''\)/);
});
