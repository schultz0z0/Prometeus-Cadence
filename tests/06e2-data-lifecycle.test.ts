import test from'node:test';import assert from'node:assert/strict';
import{duplicateIdentityMatch,normalizeIdentity,retentionChoices,retentionLabel,retentionNeedsTypedConfirmation,mergeConfirmSchema,privacyPolicySchema,undoSchema}from'../src/domain/data-lifecycle.ts';
test('equal names without a trusted identifier never make a duplicate',()=>{
 assert.equal(duplicateIdentityMatch({emailA:'',emailB:'',companyA:'Empresa A',companyB:'Empresa A'}),false);
 assert.equal(duplicateIdentityMatch({emailA:' Ana@Example.com ',emailB:'ana@example.com',companyA:'A',companyB:'B'}),true);
 assert.equal(duplicateIdentityMatch({emailA:'ana@example.com',emailB:'bia@example.com',companyA:'Same',companyB:'Same'}),false);
 assert.equal(duplicateIdentityMatch({emailA:'not-an-email',emailB:'not-an-email',companyA:'',companyB:''}),false);
});
test('identity normalization accepts only strong keys and rejects partial values',()=>{
 assert.equal(normalizeIdentity('cnpj','12.345.678/0001-95'),'12345678000195');assert.equal(normalizeIdentity('cnpj','123'),null);
 assert.equal(normalizeIdentity('phone','+55 (11) 99999-8888'),'11999998888');assert.equal(normalizeIdentity('phone','(11) 3333-4444'),'1133334444');assert.equal(normalizeIdentity('phone','12345'),null);
 assert.equal(normalizeIdentity('email','  X@Y.COM '),'x@y.com');assert.equal(normalizeIdentity('email','x@'),null);
});
test('retention follows the reference minimums and confirmation rules',()=>{
 assert.deepEqual(retentionChoices('sent'),[30,60,90,180,365,730,1095,1825]);assert.deepEqual(retentionChoices('reply'),[90,180,365,730,1095,1825]);
 assert.equal(retentionLabel(30),'30 dias');assert.equal(retentionLabel(365),'1 ano');assert.equal(retentionLabel(1095),'3 anos');
 const off={active:false,sentDays:365,replyDays:365};
 assert.equal(retentionNeedsTypedConfirmation(off,{active:true,sentDays:365,replyDays:365}),true);
 assert.equal(retentionNeedsTypedConfirmation({...off,active:true},{active:true,sentDays:180,replyDays:365}),true);
 assert.equal(retentionNeedsTypedConfirmation({...off,active:true},{active:true,sentDays:730,replyDays:365}),false);
 assert.equal(retentionNeedsTypedConfirmation({...off,active:true},off),false);
 for(const bad of[{sentDays:7},{replyDays:30},{sentDays:22}])assert.equal(privacyPolicySchema.safeParse({active:true,sentDays:365,replyDays:365,expectedRevision:0,...bad}).success,false);
 assert.equal(privacyPolicySchema.safeParse({active:true,sentDays:30,replyDays:90,expectedRevision:0,confirm:'APAGAR'}).success,true);
});
test('merge and undo inputs are bounded, keyed and never accept name-based groups',()=>{
 const group={targetId:'a',sourceIds:['b'],kind:'email',value:'a@example.com'};
 assert.equal(mergeConfirmSchema.safeParse({groups:[group],token:'t',requestId:crypto.randomUUID()}).success,true);
 for(const patch of[{kind:'name_city'},{kind:'site'},{sourceIds:[]},{sourceIds:['a']},{sourceIds:Array.from({length:51},(_,i)=>'s'+i)}])assert.equal(mergeConfirmSchema.safeParse({groups:[{...group,...patch}],token:'t',requestId:crypto.randomUUID()}).success,false,JSON.stringify(patch));
 assert.equal(mergeConfirmSchema.safeParse({groups:Array.from({length:101},()=>group),token:'t',requestId:crypto.randomUUID()}).success,false);
 assert.equal(undoSchema.safeParse({requestId:'x'}).success,false);
});
