import test from 'node:test';
import assert from 'node:assert/strict';
import {channelProviderAppError} from '../src/server/channels/provider-errors.ts';
import {ChannelProviderError} from '../src/server/channels/providers/contracts.ts';
test('channel verification errors explain a known failure without exposing raw provider secrets',()=>{
 const unavailable=channelProviderAppError(new ChannelProviderError('META_SENDER_UNAVAILABLE'));
 assert.equal(unavailable.code,'META_SENDER_UNAVAILABLE');assert.equal(unavailable.status,422);assert.match(unavailable.message,/conectado/i);
 const expired=channelProviderAppError(new ChannelProviderError('META_TOKEN_EXPIRED'));assert.match(expired.message,/expirou/i);
 const foreign=channelProviderAppError(new ChannelProviderError('qa-secret-unsafe-token'));assert.equal(foreign.code,'CHANNEL_PROVIDER_FAILED');assert.ok(!JSON.stringify(foreign).includes('qa-secret'));
});
