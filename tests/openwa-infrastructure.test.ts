import test from 'node:test';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';import {once} from 'node:events';
import {createChannelIngress} from '../scripts/channel-ingress.ts';

test('private receiver exposes only health and the exact OpenWA callback surface',async()=>{
 const server=createChannelIngress();server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
 try{
  assert.equal((await fetch(origin+'/health')).status,200);
  for(const path of ['/login','/api/auth/get-session','/api/sessions','/api/channel-webhooks/meta/public','/api/channel-webhooks/openwa/a/extra'])assert.equal((await fetch(origin+path)).status,404);
  assert.equal((await fetch(origin+'/api/channel-webhooks/openwa/fixture-public')).status,405);
  assert.equal((await fetch(origin+'/api/channel-webhooks/openwa/fixture-public',{method:'POST',body:'{}'})).status,503);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('rendered Compose keeps gateway loopback, receiver private and isolates persistent auth volume',()=>{
 const fixtureEnv={...process.env,POSTGRES_PASSWORD:'fixture-owner',CADENCE_AUTH_PASSWORD:'fixture-auth',CADENCE_APP_PASSWORD:'fixture-app',CADENCE_INGRESS_PASSWORD:'fixture-ingress',CHANNEL_KEYRING_JSON:'{}',CHANNEL_ACTIVE_KEY_ID:'fixture',OPENWA_ADMIN_API_KEY:'fixture-admin-key-not-live'};
 const rendered=JSON.parse(execFileSync('docker',['compose','--env-file','.env.example','--profile','channels','config','--format','json'],{encoding:'utf8',env:fixtureEnv,windowsHide:true}));
 const gateway=rendered.services.openwa,receiver=rendered.services['channel-ingress'];
 assert.ok(gateway&&receiver);assert.equal(gateway.ports.length,1);assert.equal(gateway.ports[0].host_ip,'127.0.0.1');assert.equal(gateway.ports[0].published,'2785');assert.equal(receiver.ports,undefined);
 assert.equal(gateway.environment.API_MASTER_KEY,'fixture-admin-key-not-live');assert.equal(gateway.environment.SEND_PACING_WARMUP_SCHEDULE,'20');assert.equal(gateway.environment.SEND_PACING_COLD_DAILY_CAP,'5');
 assert.equal(gateway.environment.ENGINE_TYPE,'whatsapp-web.js');assert.equal(gateway.environment.WEBHOOK_SSRF_PROTECT,'true');assert.equal(gateway.environment.SSRF_ALLOWED_HOSTS,'channel-ingress');
 assert.equal(gateway.volumes[0].target,'/app/data');assert.match(gateway.volumes[0].source,/openwa/);
 for(const service of [gateway,receiver]){assert.equal(service.restart,'unless-stopped');for(const volume of service.volumes??[])assert.doesNotMatch(volume.source,/docker\.sock|docker_engine/);}
});
