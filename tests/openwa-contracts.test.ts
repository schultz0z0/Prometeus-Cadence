import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {whatsappCapabilities} from '../src/domain/whatsapp-capabilities.ts';
import {parseOpenwaSession,parseOpenwaQr,parseOpenwaSend,parseOpenwaRemoteMessage} from '../src/server/channels/openwa/wire.ts';
const fixture=(name:string)=>JSON.parse(readFileSync(new URL(`./fixtures/openwa/${name}.json`,import.meta.url),'utf8'));

test('provider capabilities keep Meta service window and disable retired or unknown transports',()=>{
 assert.deepEqual(whatsappCapabilities('meta'),{connectable:true,requiresServiceWindow:true,supportsOfficialTemplates:true,supportsText:true});
 assert.deepEqual(whatsappCapabilities('openwa'),{connectable:true,requiresServiceWindow:false,supportsOfficialTemplates:false,supportsText:true});
 for(const provider of ['twilio','unknown'])assert.deepEqual(whatsappCapabilities(provider),{connectable:false,requiresServiceWindow:true,supportsOfficialTemplates:false,supportsText:false});
});
test('session parser validates bounded IDs, phases and phone without forwarding gateway configuration',()=>{
 const session=parseOpenwaSession({...fixture('session'),apiKey:'not-for-forwarding',config:{proxyUrl:'private'}});
 assert.equal(session.status,'ready');assert.equal(session.phone,'15550000001');assert.equal('apiKey' in session,false);assert.equal('config' in session,false);
 for(const change of [{id:'not-a-uuid'},{status:'online'},{phone:'opaque@lid'},{engineLoaded:'yes'}])assert.throws(()=>parseOpenwaSession({...fixture('session'),...change}));
});
test('QR parser accepts bounded PNG data only and refuses executable or oversized content',()=>{
 assert.match(parseOpenwaQr(fixture('qr')).qrCode,/^data:image\/png;base64,/);
 for(const qrCode of ['https://example.test/qr','data:image/svg+xml,<svg/>','data:image/png;base64,AAAA','data:image/png;base64,'+'A'.repeat(262145)])assert.throws(()=>parseOpenwaQr({qrCode,status:'qr_ready'}));
 assert.throws(()=>parseOpenwaQr({qrCode:fixture('qr').qrCode,status:'ready'}));
});
test('HTTP acceptance requires raw WhatsApp ID and integral seconds; never supplies a delivery claim',()=>{
 assert.deepEqual(parseOpenwaSend(fixture('send')),{messageId:'true_15550000002@c.us_SAMPLE',timestamp:1792785600});
 for(const value of [{timestamp:1792785600},{messageId:'',timestamp:1792785600},{messageId:'m',timestamp:NaN},{messageId:'m',timestamp:1792785600000},{messageId:'m',timestamp:1.5}])assert.throws(()=>parseOpenwaSend(value));
});
test('stored remote messages map waMessageId, preserving session/chat proof rather than storage UUID',()=>{
 const message=parseOpenwaRemoteMessage({id:'22222222-2222-4222-8222-222222222222',waMessageId:'true_15550000002@c.us_SAMPLE',sessionId:'11111111-1111-4111-8111-111111111111',chatId:'15550000002@c.us',fromMe:true,status:'read',timestamp:1792785600});
 assert.equal(message.gatewayId,'22222222-2222-4222-8222-222222222222');assert.equal(message.remoteId,'true_15550000002@c.us_SAMPLE');assert.equal(message.status,'read');
 assert.throws(()=>parseOpenwaRemoteMessage({...message,waMessageId:null}));
});
