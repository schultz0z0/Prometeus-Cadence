import test from'node:test';import assert from'node:assert/strict';
import{canRemoveOwner,membershipChangeSchema,totpVerificationSchema}from'../src/domain/security-policy.ts';
test('removal or demotion preserves at least one other owner and fails closed on invalid counts',()=>{
 assert.equal(canRemoveOwner({targetRole:'owner',remainingOwners:0}),false);assert.equal(canRemoveOwner({targetRole:'owner',remainingOwners:1}),true);assert.equal(canRemoveOwner({targetRole:'operator',remainingOwners:0}),true);
 for(const remainingOwners of[-1,NaN,Infinity,0.5])assert.equal(canRemoveOwner({targetRole:'owner',remainingOwners}),false);assert.equal(canRemoveOwner({targetRole:'unexpected',remainingOwners:5}),false);
});
test('membership change requires a current revision and idempotency key without infrastructure roles',()=>{
 const value={memberId:'member',expectedRevision:1,requestId:crypto.randomUUID(),role:'operator'};assert.equal(membershipChangeSchema.safeParse(value).success,true);
 for(const patch of[{role:'platform_admin'},{expectedRevision:0},{requestId:'invalid'},{workspaceId:'foreign'}])assert.equal(membershipChangeSchema.safeParse({...value,...patch}).success,false);
});
test('authenticator codes are exactly six ASCII digits; setup challenge is server-owned',()=>{
 assert.equal(totpVerificationSchema.safeParse({challengeId:crypto.randomUUID(),code:'012345'}).success,true);
 for(const code of['12345','1234567','１２３４５６','123 45'])assert.equal(totpVerificationSchema.safeParse({challengeId:crypto.randomUUID(),code}).success,false);
 assert.equal(totpVerificationSchema.safeParse({challengeId:crypto.randomUUID(),code:'012345',userId:'foreign'}).success,false);
});
