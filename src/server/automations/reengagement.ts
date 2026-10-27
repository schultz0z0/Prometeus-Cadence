import type {PoolClient} from 'pg';
import type {AutomationDefinition,AutomationOccurrence} from '../../domain/automation-runtime.ts';
import {assertExecution} from '../billing/entitlements.ts';
export async function transferReengagement(c:PoolClient,definition:AutomationDefinition,occurrence:AutomationOccurrence,limit:number){
 await assertExecution(c);const {sourceListId,afterDays}=definition.payload.filters,target=definition.payload.listId;
 // The caller holds the workspace lock, membership lock and current reviewed
 // manual authorization or scheduler lease. This transaction never creates jobs
 // or publications, and identity/opt-out history stays attached to the same lead.
 const rows=(await c.query(`SELECT l.id FROM app.lead l WHERE l.list_id=$1
  AND EXISTS(SELECT 1 FROM app.cadence_enrollment e JOIN app.cadence_publication p ON p.workspace_id=e.workspace_id AND p.id=e.publication_id
   WHERE e.workspace_id=l.workspace_id AND e.lead_id=l.id AND e.state='completed' AND e.last_accepted_at IS NOT NULL
    AND e.completed_at<=clock_timestamp()-make_interval(days=>$2) AND e.completed_at>=e.last_accepted_at
    AND ($4::text='' OR p.cadence_id=$4))
  AND NOT EXISTS(SELECT 1 FROM app.cadence_enrollment e WHERE e.workspace_id=l.workspace_id AND e.lead_id=l.id AND e.state IN('active','blocked'))
  AND NOT EXISTS(SELECT 1 FROM app.cadence_enrollment e JOIN app.channel_identity i ON i.workspace_id=e.workspace_id AND i.id=e.identity_id
    WHERE e.workspace_id=l.workspace_id AND e.lead_id=l.id AND(i.reply_epoch>e.authorized_reply_epoch OR i.last_reply_at>=e.anchor_at OR EXISTS(SELECT 1 FROM app.contact_suppression s WHERE s.workspace_id=i.workspace_id AND s.identity_id=i.id AND s.scope IN('all','campaign'))))
  AND NOT EXISTS(SELECT 1 FROM app.cadence_enrollment e JOIN app.cadence_enrollment_channel ec ON ec.workspace_id=e.workspace_id AND ec.enrollment_id=e.id JOIN app.channel_identity i ON i.workspace_id=ec.workspace_id AND i.id=ec.identity_id
    WHERE e.workspace_id=l.workspace_id AND e.lead_id=l.id AND(i.reply_epoch>ec.authorized_reply_epoch OR i.last_reply_at>=e.anchor_at OR EXISTS(SELECT 1 FROM app.contact_suppression s WHERE s.workspace_id=i.workspace_id AND s.identity_id=i.id AND s.scope IN('all','campaign'))))
  AND NOT EXISTS(SELECT 1 FROM app.message_outbox o JOIN app.cadence_enrollment e ON e.workspace_id=o.workspace_id AND e.id=o.enrollment_id WHERE e.workspace_id=l.workspace_id AND e.lead_id=l.id AND o.state IN('pending','dispatching','uncertain','blocked'))
  AND NOT EXISTS(SELECT 1 FROM app.automation_lead_assignment a WHERE a.workspace_id=l.workspace_id AND a.lead_id=l.id AND a.state IN('assigned','attempted','pending_review','uncertain'))
  AND NOT EXISTS(SELECT 1 FROM app.prospecting_item i WHERE i.workspace_id=l.workspace_id AND i.lead_id=l.id AND NOT i.applied AND i.status='pending_review')
  AND NOT EXISTS(SELECT 1 FROM app.prospecting_job j WHERE j.workspace_id=l.workspace_id AND j.input->'leadIds' ? l.id AND j.state IN('queued','running','waiting_provider','cancelling','needs_reconciliation'))
  AND NOT EXISTS(SELECT 1 FROM app.automation_lead_assignment a WHERE a.workspace_id=l.workspace_id AND a.automation_id=$5 AND a.lead_id=l.id AND a.state<>'released')
  ORDER BY l.id LIMIT $3 FOR UPDATE OF l`,[sourceListId,Number(afterDays),limit,definition.payload.filters.sourceCadenceId??'',definition.id])).rows;
 for(const {id}of rows){
  await c.query("INSERT INTO app.automation_lead_assignment(workspace_id,automation_id,lead_id,definition_revision,contract_version,occurrence_id,state) VALUES(current_setting('app.workspace_id'),$1,$2,$3,'reengage-v1',$4,'transferred') ON CONFLICT(workspace_id,automation_id,lead_id) DO UPDATE SET definition_revision=EXCLUDED.definition_revision,occurrence_id=EXCLUDED.occurrence_id,state='transferred' WHERE app.automation_lead_assignment.state='released'",[definition.id,id,definition.revision,occurrence.id]);
  await c.query("UPDATE app.lead SET list_id=$2,payload=jsonb_set(payload,'{listId}',to_jsonb($2::text)) WHERE id=$1 AND list_id=$3",[id,target,sourceListId]);
 }
 if(rows.length){await c.query("UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=current_setting('app.workspace_id')");await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES(current_setting('app.workspace_id'),current_setting('app.user_id'),'automation.reengagement.transfer')");}
 await c.query("UPDATE app.automation_occurrence SET state=$2,counts=$3 WHERE id=$1",[occurrence.id,rows.length?'completed':'empty',{found:rows.length,inserted:0,duplicates:0,rejected:0,pending:0,transferred:rows.length}]);
 return rows.length;
}
