import 'server-only';
import {dispatchPool} from '../../messaging/worker-db.ts';
import {encryptCredential,decryptCredential,type EncryptedCredential} from '../crypto.ts';
import type {OpenwaTickOptions,OpenwaPhase} from '../../../domain/openwa.ts';
import {createOpenwaClient,OpenwaClientError,privateOpenwaCallback,type OpenwaClient} from './client.ts';

interface Lease {workspaceId:string;connectionId:string;token:string;fence:number;revision:number;desiredState:'connected'|'disconnected'}
interface Scope {
 operation:{remote_name:string;remote_session_id:string|null;api_key_id:string|null;webhook_id:string|null;webhook_registered:boolean;stage:string;phase:OpenwaPhase;revision:number|string;desired_state:'connected'|'disconnected'};
 connection:{workspace_id:string;id:string;revision:number|string;public_id:string};envelope:EncryptedCredential;
}
export function openwaGatewayConfig(){
 const origin=process.env.OPENWA_API_ORIGIN,apiKey=process.env.OPENWA_ADMIN_API_KEY;
 if(!origin||!apiKey)throw new OpenwaClientError('OPENWA_CONFIG_INVALID');return {origin,apiKey};
}
const leaseArgs=(lease:Lease)=>[lease.workspaceId,lease.connectionId,lease.token,lease.fence];
async function read(lease:Lease):Promise<Scope>{return (await dispatchPool().query('SELECT app.read_openwa_operation($1,$2,$3,$4) AS value',leaseArgs(lease))).rows[0].value;}
async function finish(lease:Lease,result:unknown){await dispatchPool().query('SELECT app.finish_openwa_operation($1,$2,$3,$4,$5)',[...leaseArgs(lease),JSON.stringify(result)]);}
export async function runOpenwaMaintenanceTick(options:OpenwaTickOptions,deps:{clientFactory?:typeof createOpenwaClient}={}){
 if(!Number.isFinite(Date.parse(options.now))||!Number.isInteger(options.maxConnections)||options.maxConnections<1||options.maxConnections>5)throw Error('Invalid OpenWA maintenance scope');
 let processed=0,failed=0;
 for(let index=0;index<options.maxConnections&&!options.signal?.aborted;index++){
  const lease:Lease|null=(await dispatchPool().query('SELECT app.claim_openwa_operation($1) AS value',[options.now])).rows[0].value;if(!lease)break;
  const controller=new AbortController(),abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});
  const heartbeat=setInterval(()=>{dispatchPool().query('SELECT app.heartbeat_openwa_operation($1,$2,$3,$4)',leaseArgs(lease)).catch(abort);},15000);heartbeat.unref();
  try{
   const scope=await read(lease),q=scope.operation,config=openwaGatewayConfig(),factory=deps.clientFactory??createOpenwaClient;
   const admin=factory(config),aad={workspaceId:lease.workspaceId,connectionId:lease.connectionId,provider:'openwa' as const,revision:Number(lease.revision)};
   const credentials=decryptCredential(scope.envelope,aad),operational=credentials.apiKey?factory({origin:config.origin,apiKey:credentials.apiKey}):null;
   const keyName=`pc-${lease.connectionId}-r${lease.revision}`;
   if(q.stage==='session'){
    const existing=await admin.findOwnedSession(q.remote_name),session=existing??await admin.createSession(q.remote_name);
    if(session.name!==q.remote_name)throw new OpenwaClientError('OPENWA_SESSION_MISMATCH');
    await finish(lease,{kind:'session',sessionId:session.id});
   }else if(q.stage==='key'){
    if(!q.remote_session_id)throw new OpenwaClientError('OPENWA_SESSION_MISSING');
    // Unknown plaintext after a lost create response is never adopted. Revoke by exact owned name/scope first.
    for(const key of await admin.listScopedKeys())if(key.name.startsWith(`pc-${lease.connectionId}-r`)){
     if(key.role!=='operator'||key.allowedSessions?.length!==1||key.allowedSessions[0]!==q.remote_session_id)throw new OpenwaClientError('OPENWA_KEY_SCOPE_MISMATCH');
     await admin.revokeScopedKey(key.id);
    }
    const key=await admin.createScopedKey(q.remote_session_id,keyName);
    await finish(lease,{kind:'key',keyId:key.id,envelope:encryptCredential({...credentials,apiKey:key.apiKey},aad)});
   }else if(q.stage==='webhook'){
    if(!operational||!q.remote_session_id)throw new OpenwaClientError('OPENWA_CREDENTIAL_MISSING');
    const hooks=await operational.listWebhooks(q.remote_session_id),matching=hooks.filter(h=>h.url===privateOpenwaCallback(scope.connection.public_id));
    if(matching.length>1)throw new OpenwaClientError('OPENWA_DUPLICATE_WEBHOOK');
    const hook=matching.length?await operational.updateWebhook(q.remote_session_id,matching[0].id,scope.connection.public_id,credentials.webhookSecret):await operational.createWebhook(q.remote_session_id,scope.connection.public_id,credentials.webhookSecret);
    if(!hook.active||hook.url!==privateOpenwaCallback(scope.connection.public_id))throw new OpenwaClientError('OPENWA_WEBHOOK_MISMATCH');
    await finish(lease,{kind:'webhook',webhookId:hook.id});
   }else if(q.stage==='stop'){
    if(!q.remote_session_id||!operational)throw new OpenwaClientError('OPENWA_CREDENTIAL_MISSING');
    await operational.stopSession(q.remote_session_id);await finish(lease,{kind:'stopped'});
   }else if(q.stage==='start'){
    if(!q.remote_session_id||!operational||!q.webhook_registered)throw new OpenwaClientError('OPENWA_WEBHOOK_MISSING');
    const session=await operational.readSession(q.remote_session_id);
    if(!session.engineLoaded){await read(lease);await operational.startSession(q.remote_session_id,controller.signal);}
    await finish(lease,{kind:'started'});
   }else if(q.stage==='observe'){
    if(!q.remote_session_id||!operational)throw new OpenwaClientError('OPENWA_CREDENTIAL_MISSING');
    const session=await operational.readSession(q.remote_session_id);
    await finish(lease,{kind:'status',phase:['created','initializing'].includes(session.status)?'provisioning':session.status,phone:session.phone?'+'+session.phone:null,engineLoaded:session.engineLoaded,restricted:!!session.restriction});
   }else if(q.stage==='logout'){
    let confirmed=!q.remote_session_id;
    if(q.remote_session_id){
     const api=operational??admin;
     try{await api.logoutSession(q.remote_session_id);confirmed=true;}
     catch{
      // A stop prevents boot/reconnect, but cannot prove device unlink. Keep that uncertainty visible.
      await api.stopSession(q.remote_session_id);confirmed=false;
     }
    }
    await finish(lease,{kind:'logout',confirmed});
   }else if(q.stage==='revoke'){
    if(q.api_key_id)await admin.revokeScopedKey(q.api_key_id);
    for(const key of await admin.listScopedKeys())if(key.name.startsWith(`pc-${lease.connectionId}-r`)&&key.role==='operator'&&key.allowedSessions?.length===1&&key.allowedSessions[0]===q.remote_session_id)await admin.revokeScopedKey(key.id);
    await finish(lease,{kind:'revoked'});
   }
   processed++;
  }catch(error){failed++;const code=error instanceof OpenwaClientError?error.code:'OPENWA_OPERATION_FAILED';try{await finish(lease,{kind:'failure',code});}catch{/* A revoked lease has no authority to write. */}}
  finally{clearInterval(heartbeat);options.signal?.removeEventListener('abort',abort);}
 }
 return {processed,failed};
}
