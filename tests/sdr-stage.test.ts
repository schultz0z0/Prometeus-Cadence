import test from 'node:test';import assert from 'node:assert/strict';
import {defaultSdrDraft} from '../src/domain/sdr-policy.ts';
import {advance,nextRequired,pickOfferSlots,saleLinkProblem,startProgress,timezoneLabel,unlistedTimes} from '../src/domain/sdr-stage.ts';
const draft={...defaultSdrDraft(),qualification:[{question:'Porte?',field:'porte',required:true},{question:'Ferramentas?',field:'ferramentas',required:false}]};
const leadIds=new Set(['m1','m2']);
test('an agent with no required question starts qualified',()=>{
 assert.equal(startProgress({...draft,qualification:[{question:'Porte?',field:'porte',required:false}]}).stage,'qualified');
 assert.equal(startProgress(draft).stage,'qualifying');
 assert.equal(nextRequired(draft,{}),'porte');
});
test('a required answer counts only when it points to a lead message',()=>{
 const p=startProgress(draft);
 const foreign=advance(draft,p,{fields:[{field:'porte',value:'5',messageId:'agent-1'}],refused:false,leadIds});
 assert.deepEqual(foreign.progress.answers,{});assert.equal(foreign.progress.stage,'qualifying');
 const ok=advance(draft,p,{fields:[{field:'porte',value:'5',messageId:'m1'},{field:'outro',value:'x',messageId:'m1'}],refused:false,leadIds});
 assert.deepEqual(ok.progress.answers,{porte:{value:'5',messageId:'m1'}});assert.equal(ok.progress.stage,'qualified');assert.equal(ok.handoff,null);
});
test('two unanswered asks or a refusal hand off',()=>{
 let p={...startProgress(draft),asked:'porte'};
 const first=advance(draft,p,{fields:[],refused:false,leadIds});assert.equal(first.handoff,null);assert.equal(first.progress.attempts.porte,1);
 const second=advance(draft,{...first.progress,asked:'porte'},{fields:[],refused:false,leadIds});
 assert.equal(second.handoff,'não respondeu a pergunta obrigatória: Porte?');
 assert.equal(advance(draft,p,{fields:[],refused:true,leadIds}).handoff,'não respondeu a pergunta obrigatória: Porte?');
});
test('offer slots span at least two days and carry readable labels',()=>{
 const days=['2026-11-16','2026-11-17','2026-11-18'],slots=days.flatMap(d=>[12,13,14,15].map(h=>({start:`${d}T${String(h).padStart(2,'0')}:00:00.000Z`,end:`${d}T${String(h).padStart(2,'0')}:30:00.000Z`}))).slice(0,10);
 const o=pickOfferSlots(slots,'America/Sao_Paulo');
 assert.deepEqual(o.slots.map(s=>s.id),['s1','s2','s3','s4','s5','s6']);
 assert.ok(new Set(o.slots.map(s=>s.start.slice(0,10))).size>=2);
 assert.equal(o.slots[0].label,'segunda, 16/11 às 09:00');assert.equal(o.timezone,'America/Sao_Paulo');
 assert.equal(timezoneLabel('America/Sao_Paulo'),'horário de Brasília');
});
test('unlisted times are caught',()=>{
 assert.deepEqual(unlistedTimes('Pode ser 10h ou 15h?',[{label:'segunda, 16/11 às 10:00'}]),['15h']);
 assert.deepEqual(unlistedTimes('Tenho segunda às 10:00 ou 10h30?',[{label:'segunda, 16/11 às 10:00'},{label:'segunda, 16/11 às 10:30'}]),[]);
});
test('the sale link must be the configured one and the only one',()=>{
 const link='https://pay.example.com/x';
 assert.equal(saleLinkProblem(`Pode fechar aqui: ${link}`,link),null);
 assert.ok(saleLinkProblem('Vou te mandar o link.',link));
 assert.ok(saleLinkProblem(`Fecha em ${link} ou https://outro.com`,link));
});
