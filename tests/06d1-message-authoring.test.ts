import test from 'node:test';import assert from 'node:assert/strict';
import {validateAuthoringVariables,chooseMessageVariant,inspectAttachment,copyTemplateToStep,messageVersion,authoredVariantSupported} from '../src/domain/message-authoring.ts';
import {planningInputSchema} from '../src/server/planning/contracts.ts';
test('unknown variables block publication including subject, and inherited names remain unknown',()=>{
 assert.deepEqual(validateAuthoringVariables({body:'Olá {{inexistente}} {{nome}} {{inexistente}} {{constructor}}',allowed:['nome']}),{valid:false,unknown:['inexistente','constructor']});
 assert.deepEqual(validateAuthoringVariables({body:'Olá {{nome}}',allowed:['nome']}),{valid:true,unknown:[]});
});
test('complete B variant selection is stable per enrollment and incomplete B cannot be selected',()=>{
 const choices=Array.from({length:100},(_,i)=>chooseMessageVariant('enrollment-'+i,true));assert.ok(choices.includes('A')&&choices.includes('B'));assert.ok(choices.filter(v=>v==='B').length>=40&&choices.filter(v=>v==='B').length<=60);
 for(let i=0;i<100;i++){assert.equal(chooseMessageVariant('enrollment-'+i,true),choices[i]);assert.equal(chooseMessageVariant('enrollment-'+i,false),'A');}
});
test('attachment validation checks bytes and claimed MIME, not the filename alone',()=>{
 assert.equal(inspectAttachment({name:'proposal.pdf',mime:'application/pdf',bytes:new TextEncoder().encode('%PDF-1.7\ncontent\n%%EOF')}).state,'ready');
 for(const f of [{name:'fake.pdf',mime:'application/pdf',bytes:new TextEncoder().encode('<script>alert(1)</script>')},{name:'page.html',mime:'text/html',bytes:new TextEncoder().encode('<html>bad</html>')},{name:'../file.pdf',mime:'application/pdf',bytes:new TextEncoder().encode('%PDF-1.7')},{name:'huge.pdf',mime:'application/pdf',bytes:new Uint8Array(10*1024*1024+1)}])assert.equal(inspectAttachment(f).state,'rejected');
});
test('using a template copies editable content without replacing step timing, stop rules or attachment draft',()=>{
 const step={id:'step',channel:'EMAIL' as const,delayDays:3,body:'old',stopOnReply:false,attachmentIds:['own-file']},template={id:'t',name:'T',channel:'EMAIL' as const,tags:[],subject:'Oi {{nome}}',body:'Olá {{nome}}'};
 const copied=copyTemplateToStep(step,template);assert.equal(copied.body,'Olá {{nome}}');assert.equal(copied.subject,'Oi {{nome}}');assert.equal(copied.delayDays,3);assert.equal(copied.stopOnReply,false);assert.deepEqual(copied.attachmentIds,['own-file']);assert.equal(step.body,'old');assert.throws(()=>copyTemplateToStep(step,{...template,channel:'WHATSAPP'}));
});
test('reviewed AI preview can explicitly target B while unknown variants remain rejected',()=>{
 const input={kind:'planning',task:'message_preview',cadenceId:'cadence',stepId:'step',leadId:'lead',variant:'B'};assert.equal(planningInputSchema.safeParse(input).success,true);assert.equal(planningInputSchema.safeParse({...input,variant:'C'}).success,false);
});
test('an incomplete B draft cannot silently inherit the A subject or attachments in its preview',()=>{
 const a={id:'step',channel:'EMAIL' as const,delayDays:0,body:'A',subject:'A subject',attachmentIds:['A-file'],stopOnReply:true,variantB:{body:'B'}};const b=messageVersion(a,'B');assert.equal(b.body,'B');assert.equal(b.subject,undefined);assert.deepEqual(b.attachmentIds,[]);assert.equal(a.subject,'A subject');assert.deepEqual(a.attachmentIds,['A-file']);
});
test('approved Meta template content cannot enable authored B even when this recipient would receive A',()=>{
 assert.equal(authoredVariantSupported('template',true),false);assert.equal(authoredVariantSupported('template',false),true);assert.equal(authoredVariantSupported('email',true),true);assert.equal(authoredVariantSupported('text',true),true);
});
