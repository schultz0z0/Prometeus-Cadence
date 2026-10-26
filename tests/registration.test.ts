import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistration, entryDestination, signupDestination } from '../src/domain/registration.ts';
import {LEGAL_VERSION,findLegalDocument} from '../src/domain/legal-documents.ts';
const valid = { phone: '(21) 97323-1943', accepted: true, termsVersion: LEGAL_VERSION, privacyVersion: LEGAL_VERSION };
test('registration normalizes contact and binds explicit acceptance to current documents', () => {
  assert.equal(validateRegistration(valid).phoneNumber, '+5521973231943');
  assert.equal(validateRegistration({...valid,phone:'+1 415 555 0123'}).phoneNumber, '+14155550123');
  for (const value of [undefined, {...valid,accepted:false}, {...valid,termsVersion:'old'}, {...valid,phone:'123'}, {...valid,phone:'abc21973231943'}, {...valid,phone:'+5521<script>'}])
    assert.throws(()=>validateRegistration(value));
});
test('entry only carries known local invitation/onboarding destinations', () => {
  const invite='/accept-invitation?id=abc-123';
  assert.equal(entryDestination(invite), invite);
  for(const unsafe of ['https://evil.test','//evil.test','/api/auth/sign-out','/accept-invitation?id=abc&next=https://evil.test','/\\evil.test','/onboarding/workspace?signupPlan=pro&signupMode=trial'])
    assert.equal(entryDestination(unsafe),'/dashboard');
  assert.equal(signupDestination('essential','trial'),'/onboarding/workspace?signupPlan=essential&signupMode=trial');
  assert.equal(signupDestination('pro','trial'),'/onboarding/workspace');
});
test('accepted historical documents remain addressable and unknown versions do not alias current terms',()=>{
 const old=findLegalDocument('terms','homologacao-2026-10-26');assert.equal(old?.historic,true);assert.equal(old?.version,'homologacao-2026-10-26');
 assert.equal(findLegalDocument('privacy')?.version,LEGAL_VERSION);
 for(const version of ['old','constructor','toString','__proto__'])assert.equal(findLegalDocument('terms',version),null);
});
