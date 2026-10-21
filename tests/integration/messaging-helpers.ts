import {randomUUID} from 'node:crypto';
import {webhookRequest} from '../../src/server/channels/webhooks.ts';
import {syncTemplates} from '../../src/server/channels/templates.ts';
import {recordConsent} from '../../src/server/messaging/consent.ts';
import {defaultCadenceSettings} from '../../src/demo/seed.ts';
import {verifiedMetaFixture,testAdmin} from './whatsapp-helpers.ts';
import type {Cadence,Lead} from '../../src/domain/model.ts';
export async function publicationFixture(){
 const f=await verifiedMetaFixture(),now=new Date(),date=now.toISOString(),time=new Date(now.getTime()+60000).toISOString().slice(11,16);
 await webhookRequest(f.request({messages:[{id:'wamid.'+randomUUID(),from:'5541988888888',timestamp:String(Math.floor(now.getTime()/1000)),type:'text',text:{body:'Oi'}}]}),f.publicId,'meta');
 const templates=await syncTemplates(f.u.p,f.connection.id,1,{adapter:f.adapter});
 const listId=randomUUID(),lead:Lead={id:randomUUID(),listId,name:'Clínica QA',phone:'+5541988888888',qualification:'qualified',source:'MANUAL',createdAt:date};
 const cadence:Cadence={id:randomUUID(),listId,name:'Cadência QA',status:'draft',createdAt:date,steps:[{id:'first',channel:'WHATSAPP',delayDays:0,body:'Olá {{nome}}',stopOnReply:true},{id:'second',channel:'WHATSAPP',delayDays:2,body:'Podemos conversar?',stopOnReply:true}],settings:{...defaultCadenceSettings(),timezone:'UTC',weekdays:[0,1,2,3,4,5,6],sendTime:time,skipHolidays:false,excludeReplied:false}};
 const identity=await testAdmin(async c=>{
  await c.query('INSERT INTO app.list(workspace_id,id,name) VALUES($1,$2,$3)',[f.u.p.workspaceId,listId,'QA']);
  await c.query('INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[f.u.p.workspaceId,lead.id,listId,lead]);
  await c.query('INSERT INTO app.cadence(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[f.u.p.workspaceId,cadence.id,listId,cadence]);
  await c.query('INSERT INTO app.messaging_limits(workspace_id,workspace_daily_limit,timezone) VALUES($1,10,\'UTC\')',[f.u.p.workspaceId]);
  await c.query('UPDATE app.channel_sender SET daily_limit=10 WHERE workspace_id=$1',[f.u.p.workspaceId]);
  return (await c.query('SELECT id FROM app.channel_identity WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0].id as string;
 });
 await recordConsent(f.u.p,{requestId:randomUUID(),identityId:identity,purpose:'campaign',source:'manual QA',occurredAt:date,evidence:'Contato fictício autorizado no ambiente de testes.'});
 const input={cadenceId:cadence.id,expectedRevision:0,senderId:f.sender.id,leadIds:[lead.id],bindings:{first:{kind:'text' as const,text:'Olá {{nome}}'},second:{kind:'template' as const,templateId:templates[0].id,templateRevision:templates[0].revision,variables:{'body.1':'{{nome}}'}}}};
 return {...f,lead,cadence,identity,input,now};
}
