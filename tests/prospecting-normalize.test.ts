import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCandidate,strongIdentities} from '../src/server/prospecting/normalize.ts';
test('normalize preserves string registry IDs and does not invent phone geography',()=>{
  const c=normalizeCandidate({id:'001',name:'  Empresa A ',cnpj:'00.ABC.123/0001-90',email:' TEST@EXAMPLE.COM ',phone:'1234-5678',site:'https://WWW.Example.com/path?q=1'},'CNPJ');
  assert.equal(c.sourceRef,'001');assert.equal(c.cnpj,'00ABC123000190');
  assert.equal(c.phone,'12345678');assert.equal(c.email,'test@example.com');assert.equal(c.site,'https://example.com/');
  assert.throws(()=>normalizeCandidate({id:'bad'},'MAPS'));
});
test('shared contacts and domains are not strong company identities',()=>{
  const a=normalizeCandidate({id:'one',name:'A',phone:'5511999999999',email:'contador@example.com',site:'example.com'},'MAPS');
  const b=normalizeCandidate({...a,id:'two',sourceRef:'two',name:'B'},'MAPS');
  assert.deepEqual(strongIdentities(a),['source:MAPS:one']);
  assert.deepEqual(strongIdentities(b),['source:MAPS:two']);
});
