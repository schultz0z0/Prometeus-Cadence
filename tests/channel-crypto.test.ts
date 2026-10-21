import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptCredential,decryptCredential} from '../src/server/channels/crypto.ts';
test('credential encryption authenticates tenant provider revision and ciphertext without nonce reuse',()=>{
 process.env.CHANNEL_KEYRING_JSON=JSON.stringify({qa:Buffer.alloc(32,7).toString('base64')});process.env.CHANNEL_ACTIVE_KEY_ID='qa';
 const aad={workspaceId:'a',connectionId:'c',provider:'meta' as const,revision:1},value={accessToken:'fixture-secret'};
 const first=encryptCredential(value,aad),second=encryptCredential(value,aad);
 assert.notEqual(first.iv,second.iv);assert.deepEqual(decryptCredential(first,aad),value);
 assert.equal(JSON.stringify(first).includes('fixture-secret'),false);
 for(const change of [{workspaceId:'b'},{connectionId:'other'},{provider:'twilio' as const},{revision:2}])assert.throws(()=>decryptCredential(first,{...aad,...change}));
 assert.throws(()=>decryptCredential({...first,ciphertext:Buffer.alloc(16).toString('base64')},aad));
 process.env.CHANNEL_KEYRING_JSON=JSON.stringify({qa:Buffer.alloc(32,7).toString('base64'),next:Buffer.alloc(32,8).toString('base64')});process.env.CHANNEL_ACTIVE_KEY_ID='next';
 assert.deepEqual(decryptCredential(first,aad),value);assert.equal(encryptCredential(value,aad).keyId,'next');
 delete process.env.CHANNEL_KEYRING_JSON;assert.throws(()=>encryptCredential(value,aad),/cifra/i);
});
