import test from 'node:test';
import assert from 'node:assert/strict';
import {templateSchema,sequenceDraftSchema,sequenceMode,renderLinkedinText,SEQUENCE_DAILY_CAP} from '../src/domain/linkedin-sequence.ts';
import {NO_LINKEDIN} from '../src/domain/linkedin-capabilities.ts';

test('07A.3b templates: invite notes up to 300, messages up to 8000, only known tokens',()=>{
 assert.equal(templateSchema.safeParse({name:'[RE] Convite',kind:'invite',body:'Olá, {nome}!'}).success,true);
 assert.equal(templateSchema.safeParse({name:'x',kind:'invite',body:'a'.repeat(301)}).success,false);
 assert.equal(templateSchema.safeParse({name:'x',kind:'message',body:'a'.repeat(8000)}).success,true);
 assert.equal(templateSchema.safeParse({name:'x',kind:'message',body:'Oi {apelido}'}).success,false);
 assert.equal(templateSchema.safeParse({name:'',kind:'message',body:'Oi'}).success,false);
});

test('07A.3b sequences: 1 to 10 steps, whole days, a campaign',()=>{
 const ok={name:'[RE] Pós-aceite',campaignId:crypto.randomUUID(),steps:[{delayDays:0,body:'Obrigado, {nome}!'},{delayDays:3,body:'Posso ajudar?'}]};
 assert.equal(sequenceDraftSchema.safeParse(ok).success,true);
 assert.equal(sequenceDraftSchema.safeParse({...ok,steps:[]}).success,false);
 assert.equal(sequenceDraftSchema.safeParse({...ok,steps:Array.from({length:11},()=>({delayDays:1,body:'x'}))}).success,false);
 assert.equal(sequenceDraftSchema.safeParse({...ok,steps:[{delayDays:1.5,body:'x'}]}).success,false);
 assert.equal(sequenceDraftSchema.safeParse({...ok,steps:[{delayDays:61,body:'x'}]}).success,false);
 assert.equal(sequenceDraftSchema.safeParse({...ok,steps:[{delayDays:1,body:'  '}]}).success,false);
});

test('07A.3b mode: automatic only when the platform attests automatic sending; assisted makes drafts; none blocks',()=>{
 assert.equal(sequenceMode({...NO_LINKEDIN,sendMessage:'automatic'}),'automatic');
 assert.equal(sequenceMode({...NO_LINKEDIN,sendMessage:'assisted'}),'assisted');
 assert.equal(sequenceMode(NO_LINKEDIN),null);
 assert.equal(SEQUENCE_DAILY_CAP,30);
});

test('07A.3b text: facts from the profile only; a missing fact stops instead of inventing',()=>{
 assert.equal(renderLinkedinText('Oi, {nome} da {empresa}',{nome:'Ana',empresa:'[RE] Acme'},8000),'Oi, Ana da [RE] Acme');
 assert.equal(renderLinkedinText('Oi, {nome} da {empresa}',{nome:'Ana'},8000),null);
 assert.equal(renderLinkedinText('x'.repeat(10),{},5),null);
});
