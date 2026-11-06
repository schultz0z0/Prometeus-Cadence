import {randomUUID} from 'node:crypto';
import {defaultCadenceSettings} from '../../src/demo/seed.ts';

export async function seedExecutionDiary(db, workspaceId, userId, count = 3) {
  const c = await db.connect();
  const list = randomUUID(), lead = randomUUID(), cadence = randomUUID(), publication = randomUUID();
  const connection = randomUUID(), sender = randomUUID(), identity = randomUUID(), conversation = randomUUID(), enrollment = randomUUID();
  const leadName = '[RE] Diário Ágata', cadenceName = '[RE] Diário demonstração';
  const ids = [];
  try {
    await c.query('BEGIN');
    await c.query('INSERT INTO app.list VALUES ($1,$2,$3)', [workspaceId, list, '[RE] Diário']);
    await c.query('INSERT INTO app.lead VALUES ($1,$2,$3,$4)', [workspaceId, lead, list, {id:lead,listId:list,name:leadName,email:'re-agata@example.com',source:'MANUAL',qualification:'pending',createdAt:new Date().toISOString()}]);
    await c.query('INSERT INTO app.cadence (workspace_id,id,list_id,payload) VALUES ($1,$2,$3,$4)', [workspaceId,cadence,list,{
      id:cadence,listId:list,name:cadenceName,status:'paused',settings:defaultCadenceSettings(),createdAt:new Date().toISOString(),
      steps:Array.from({length:count},(_,index)=>({id:'step-'+index,channel:'EMAIL',delayDays:1,body:'[RE] Mensagem de teste',stopOnReply:true})),
    }]);
    await c.query("INSERT INTO app.channel_connection (workspace_id,id,provider,name,public_id,state,identifiers,created_by,channel) VALUES ($1,$2,'smtp-imap','[RE] Inativo',$2,'disconnected','{}',$3,'EMAIL')", [workspaceId,connection,userId]);
    await c.query("INSERT INTO app.channel_sender (workspace_id,id,connection_id,provider,external_id,identity_scope,ready,channel) VALUES ($1,$2,$3,'smtp-imap',$2,$2,false,'EMAIL')", [workspaceId,sender,connection]);
    await c.query("INSERT INTO app.channel_identity (workspace_id,id,scope,external_id) VALUES ($1,$2,$3,'re-agata@example.com')", [workspaceId,identity,sender]);
    await c.query("INSERT INTO app.channel_conversation (workspace_id,id,connection_id,sender_id,identity_id,lead_id,channel) VALUES ($1,$2,$3,$4,$5,$6,'EMAIL')", [workspaceId,conversation,connection,sender,identity,lead]);
    await c.query("INSERT INTO app.cadence_publication (workspace_id,id,cadence_id,created_by,snapshot,state) VALUES ($1,$2,$3,$4,$5,'paused')", [workspaceId,publication,cadence,userId,{cadence:{name:cadenceName}}]);
    await c.query("INSERT INTO app.cadence_enrollment (workspace_id,id,publication_id,lead_id,identity_id,state,anchor_at,next_at,authorized_reply_epoch) VALUES ($1,$2,$3,$4,$5,'stopped',now(),now(),0)", [workspaceId,enrollment,publication,lead,identity]);
    for (let i=0; i<=count; i++) {
      const message = randomUUID(), adHoc = i===count;
      const state = ['accepted','failed','cancelled'][i%3], reason = state==='cancelled'?'REPLY':null;
      const at = new Date(Date.now()-i*1000).toISOString();
      const acceptedAt = state==='accepted'?at:null;
      await c.query("INSERT INTO app.channel_message (workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,text,state,accepted_at,created_at,channel) VALUES ($1,$2,$3,$4,$5,$6,'outbound','[RE] Texto interno da fixture',$7,$8,$9,'EMAIL')", [workspaceId,message,connection,sender,identity,conversation,state,acceptedAt,at]);
      await c.query("INSERT INTO app.message_outbox (workspace_id,message_id,publication_id,enrollment_id,step_index,connection_id,sender_id,identity_id,actor_id,authority_kind,prepared_send,state,accepted_at,created_at,blocked_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'admin','{}',$10,$11,$12,$13)", [workspaceId,message,adHoc?null:publication,adHoc?null:enrollment,adHoc?null:i,connection,sender,identity,userId,state,acceptedAt,at,reason]);
      if (!adHoc) ids.push(message);
    }
    await c.query('COMMIT');
    return {ids,leadName,cadenceName};
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
