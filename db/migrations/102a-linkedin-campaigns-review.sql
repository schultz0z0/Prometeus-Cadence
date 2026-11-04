-- 07A.2 review. The invite ledger belongs to the LinkedIn member, not to one connection row: a reconnect keeps it.
-- Campaigns on a disconnected account end. Claims take accounts in a fixed order and skip a busy one. A send left in
-- 'sending' by a crash becomes 'uncertain' (never resent). A wasted slot (skipped note, released claim) is given back.
ALTER TABLE app.linkedin_invite_operation ADD COLUMN member_id text;
UPDATE app.linkedin_invite_operation o SET member_id=a.external_member_id FROM app.linkedin_account a WHERE a.workspace_id=o.workspace_id AND a.id=o.account_id;
ALTER TABLE app.linkedin_invite_operation ALTER COLUMN member_id SET NOT NULL,DROP CONSTRAINT linkedin_invite_operation_pkey,ADD PRIMARY KEY(member_id,external_id);
DROP INDEX app.linkedin_invite_day;
CREATE INDEX linkedin_invite_day ON app.linkedin_invite_operation(member_id,day);
ALTER TABLE app.linkedin_account ADD COLUMN prev_invite_at timestamptz;
ALTER TABLE app.linkedin_campaign_person ADD COLUMN industry text;

CREATE OR REPLACE FUNCTION app.revoke_linkedin_account(p_account text,p_expected bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);a app.linkedin_account;
BEGIN
 PERFORM app.connector_actor();
 SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=ws AND id=p_account FOR UPDATE;
 IF NOT FOUND OR a.state='revoked' THEN RAISE EXCEPTION 'LINKEDIN_NOT_FOUND';END IF;
 IF a.revision<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 UPDATE app.linkedin_account SET state='revoked',revoked_at=clock_timestamp(),credential_epoch=credential_epoch+1,revision=revision+1,remote_delete_pending=true,
  sync_token=NULL,sync_lease_until=NULL,sync_failures=0,next_sync_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_account;
 UPDATE app.linkedin_connect_attempt SET cancelled_at=clock_timestamp() WHERE workspace_id=ws AND bound_at IS NULL AND cancelled_at IS NULL;
 INSERT INTO app.linkedin_account_event(workspace_id,account_id,remote_id,kind,state,actor) VALUES(ws,p_account,'revoke:'||a.credential_epoch,'revoked','revoked',current_setting('app.user_id',true));
 -- 07A.2: campaigns on this account end; nothing more can be sent, accepted or withdrawn through it.
 UPDATE app.linkedin_campaign SET state='completed',revision=revision+1,last_error='A conta LinkedIn foi desconectada.',updated_at=clock_timestamp()
  WHERE workspace_id=ws AND account_id=p_account AND state IN('active','paused');
 RETURN a.external_account_id;
END $$;

CREATE OR REPLACE FUNCTION app.finish_linkedin_collect(p_ws text,p_id text,p_token text,p_people jsonb,p_cursor text,p_done boolean,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.linkedin_campaign;p jsonb;n integer;member text;
BEGIN
 SELECT * INTO c FROM app.linkedin_campaign WHERE workspace_id=p_ws AND id=p_id AND collect_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT external_member_id INTO member FROM app.linkedin_account WHERE workspace_id=p_ws AND id=c.account_id;
 IF p_error IS NULL THEN
  FOR p IN SELECT * FROM jsonb_array_elements(coalesce(p_people,'[]')) LOOP
   SELECT count(*) INTO n FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND campaign_id=p_id;
   EXIT WHEN n>=500;
   INSERT INTO app.linkedin_campaign_person(workspace_id,campaign_id,id,external_id,name,headline,company,industry,location,profile_url,degree,state,reason)
    SELECT p_ws,p_id,gen_random_uuid()::text,p->>'external',left(p->>'name',200),left(p->>'headline',300),left(p->>'company',200),left(p->>'industry',200),left(p->>'location',200),left(p->>'profileUrl',500),(p->>'degree')::int,
     CASE WHEN o.external_id IS NULL THEN 'queued' ELSE 'skipped' END,CASE WHEN o.external_id IS NULL THEN NULL ELSE 'Já convidado por esta conta LinkedIn.' END
    FROM (SELECT 1) x LEFT JOIN app.linkedin_invite_operation o ON o.member_id=member AND o.external_id=p->>'external'
    ON CONFLICT(workspace_id,campaign_id,external_id) DO NOTHING;
  END LOOP;
  SELECT count(*) INTO n FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND campaign_id=p_id;
 END IF;
 UPDATE app.linkedin_campaign SET collect_cursor=CASE WHEN p_error IS NULL THEN p_cursor ELSE collect_cursor END,collect_done=collect_done OR (p_error IS NULL AND (p_done OR n>=500)),
  last_error=left(p_error,300),collect_token=NULL,collect_lease_until=CASE WHEN p_error IS NULL THEN NULL ELSE clock_timestamp()+interval '15 minutes' END,updated_at=clock_timestamp()
  WHERE workspace_id=p_ws AND id=p_id;
END $$;

CREATE OR REPLACE FUNCTION app.claim_linkedin_invite(p_token text,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE acc record;a app.linkedin_account;pr record;d date:=(p_now AT TIME ZONE 'America/Sao_Paulo')::date;used integer;
BEGIN
 -- A crash between the claim and its result: the send may have left. Uncertain, never resent.
 WITH stale AS(UPDATE app.linkedin_campaign_person SET state='uncertain',op_token=NULL,reason='Sem confirmação do LinkedIn; o convite não será reenviado.',invited_at=coalesce(invited_at,p_now),updated_at=clock_timestamp()
   WHERE state='sending' AND updated_at<clock_timestamp()-interval '5 minutes' RETURNING workspace_id,id,campaign_id)
 , ops AS(UPDATE app.linkedin_invite_operation o SET state='uncertain' FROM stale WHERE o.workspace_id=stale.workspace_id AND o.person_id=stale.id AND o.state='sending' RETURNING 1)
 INSERT INTO app.linkedin_campaign_event(workspace_id,campaign_id,person_id,kind,at) SELECT workspace_id,campaign_id,id,'uncertain',p_now FROM stale ON CONFLICT DO NOTHING;
 FOR acc IN SELECT DISTINCT c.workspace_id,c.account_id,la.external_member_id FROM app.linkedin_campaign c JOIN app.linkedin_account la ON la.workspace_id=c.workspace_id AND la.id=c.account_id
   WHERE c.state='active' AND la.state='ready' ORDER BY la.external_member_id,c.workspace_id,c.account_id LOOP
  -- Another worker on this LinkedIn member: skip it this round instead of waiting (no lock cycles).
  CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtextextended('linkedin-invite:'||acc.external_member_id,0));
  SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=acc.workspace_id AND id=acc.account_id FOR UPDATE;
  CONTINUE WHEN a.state<>'ready' OR a.invite_hold_until>p_now OR a.last_invite_at>p_now-interval '20 minutes';
  SELECT count(*) INTO used FROM app.linkedin_invite_operation WHERE member_id=a.external_member_id AND day=d AND state<>'failed';
  CONTINUE WHEN used>=12;
  LOOP
   SELECT p.*,c.draft INTO pr FROM app.linkedin_campaign_person p JOIN app.linkedin_campaign c ON c.workspace_id=p.workspace_id AND c.id=p.campaign_id
    WHERE c.workspace_id=a.workspace_id AND c.account_id=a.id AND c.state='active' AND p.state='queued'
     AND (SELECT count(*) FROM app.linkedin_invite_operation o WHERE o.workspace_id=c.workspace_id AND o.campaign_id=c.id AND o.day=d AND o.state<>'failed')<(c.draft->>'dailyLimit')::int
    ORDER BY c.activated_at,p.created_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED;
   EXIT WHEN NOT FOUND;
   BEGIN
    INSERT INTO app.linkedin_invite_operation(workspace_id,account_id,member_id,external_id,campaign_id,person_id,state,day) VALUES(a.workspace_id,a.id,a.external_member_id,pr.external_id,pr.campaign_id,pr.id,'sending',d);
   EXCEPTION WHEN unique_violation THEN
    UPDATE app.linkedin_campaign_person SET state='skipped',reason='Já convidado por esta conta LinkedIn.',updated_at=clock_timestamp() WHERE workspace_id=pr.workspace_id AND id=pr.id;
    CONTINUE;
   END;
   UPDATE app.linkedin_campaign_person SET state='sending',op_token=p_token,updated_at=clock_timestamp() WHERE workspace_id=pr.workspace_id AND id=pr.id;
   UPDATE app.linkedin_account SET prev_invite_at=last_invite_at,last_invite_at=p_now WHERE workspace_id=a.workspace_id AND id=a.id;
   RETURN jsonb_build_object('workspaceId',a.workspace_id,'accountId',a.id,'external',a.external_account_id,'epoch',a.credential_epoch,'capabilitiesVersion',a.capabilities_version,
    'campaignId',pr.campaign_id,'personId',pr.id,'providerId',pr.external_id,'name',pr.name,'company',pr.company,'headline',pr.headline,'industry',pr.industry,
    'note',pr.draft->>'note','proof',pr.draft->>'proof');
  END LOOP;
 END LOOP;
 RETURN NULL;
END $$;
-- Give back the account's slot when nothing was sent.
CREATE FUNCTION app.linkedin_release_slot(p_ws text,p_person text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE app.linkedin_account a SET last_invite_at=a.prev_invite_at FROM app.linkedin_campaign_person p JOIN app.linkedin_campaign c ON c.workspace_id=p.workspace_id AND c.id=p.campaign_id
  WHERE p.workspace_id=p_ws AND p.id=p_person AND a.workspace_id=c.workspace_id AND a.id=c.account_id
$$;
CREATE OR REPLACE FUNCTION app.linkedin_invite_recheck(p_ws text,p_person text,p_token text,p_epoch bigint,p_caps text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.linkedin_campaign_person;ok boolean;
BEGIN
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND id=p_person AND op_token=p_token AND state='sending' FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 SELECT EXISTS(SELECT 1 FROM app.linkedin_campaign c JOIN app.linkedin_account a ON a.workspace_id=c.workspace_id AND a.id=c.account_id
  WHERE c.workspace_id=p_ws AND c.id=p.campaign_id AND c.state='active' AND a.state='ready' AND a.credential_epoch=p_epoch AND p_caps IS NOT NULL AND a.capabilities_version=p_caps) INTO ok;
 IF ok THEN RETURN true;END IF;
 DELETE FROM app.linkedin_invite_operation WHERE workspace_id=p_ws AND person_id=p_person AND state='sending';
 UPDATE app.linkedin_campaign_person SET state='queued',op_token=NULL,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_person;
 PERFORM app.linkedin_release_slot(p_ws,p_person);
 RETURN false;
END $$;
CREATE OR REPLACE FUNCTION app.finish_linkedin_invite(p_ws text,p_person text,p_token text,p_outcome text,p_reason text,p_invitation text,p_hold_until timestamptz,p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.linkedin_campaign_person;
BEGIN
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND id=p_person AND op_token=p_token AND state='sending' FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF p_outcome IN('skipped','held') THEN
  DELETE FROM app.linkedin_invite_operation WHERE workspace_id=p_ws AND person_id=p_person AND state='sending';
  PERFORM app.linkedin_release_slot(p_ws,p_person);
  IF p_outcome='held' THEN UPDATE app.linkedin_account a SET invite_hold_until=p_hold_until FROM app.linkedin_campaign c WHERE c.workspace_id=p_ws AND c.id=p.campaign_id AND a.workspace_id=p_ws AND a.id=c.account_id;END IF;
 ELSE
  UPDATE app.linkedin_invite_operation SET state=CASE p_outcome WHEN 'sent' THEN 'sent' WHEN 'uncertain' THEN 'uncertain' ELSE 'failed' END WHERE workspace_id=p_ws AND person_id=p_person AND state='sending';
 END IF;
 UPDATE app.linkedin_campaign_person SET state=CASE p_outcome WHEN 'sent' THEN 'invited' WHEN 'held' THEN 'queued' ELSE p_outcome END,op_token=NULL,reason=left(p_reason,300),
  invitation_id=p_invitation,invited_at=CASE WHEN p_outcome IN('sent','uncertain') THEN p_now END,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_person;
 IF p_outcome IN('sent','uncertain') THEN
  INSERT INTO app.linkedin_campaign_event(workspace_id,campaign_id,person_id,kind,at) VALUES(p_ws,p.campaign_id,p_person,CASE WHEN p_outcome='sent' THEN 'invited' ELSE 'uncertain' END,p_now) ON CONFLICT DO NOTHING;
 END IF;
END $$;
-- Expiry candidates: invited ones to withdraw, and uncertain ones (nothing to withdraw) that simply stop being waited for.
DROP FUNCTION app.claim_linkedin_expired(timestamptz,integer);
CREATE FUNCTION app.claim_linkedin_expired(p_now timestamptz,p_limit integer) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT jsonb_build_object('workspaceId',p.workspace_id,'personId',p.id,'invitationId',p.invitation_id,'providerId',p.external_id,
   'enrich',(c.draft->>'enrichOnAccept')::boolean,'external',a.external_account_id,'capabilitiesVersion',a.capabilities_version) x
  FROM app.linkedin_campaign_person p JOIN app.linkedin_campaign c ON c.workspace_id=p.workspace_id AND c.id=p.campaign_id
  JOIN app.linkedin_account a ON a.workspace_id=c.workspace_id AND a.id=c.account_id AND a.state='ready'
  WHERE p.state IN('invited','uncertain') AND p.invited_at<=p_now-make_interval(days=>(c.draft->>'expireDays')::int)
  ORDER BY p.invited_at LIMIT least(greatest(p_limit,1),50)) s
$$;
CREATE OR REPLACE FUNCTION app.expire_linkedin_person(p_ws text,p_person text,p_now timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.linkedin_campaign_person;c app.linkedin_campaign;lid text;
BEGIN
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND id=p_person FOR UPDATE;
 IF NOT FOUND OR p.state NOT IN('invited','uncertain') THEN RETURN false;END IF;
 SELECT * INTO c FROM app.linkedin_campaign WHERE workspace_id=p_ws AND id=p.campaign_id;
 IF c.other_list_id IS NOT NULL THEN lid:=app.linkedin_person_lead(p_ws,c.other_list_id,p,'{}'::jsonb);END IF;
 UPDATE app.linkedin_campaign_person SET state='expired',lead_id=lid,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_person;
 INSERT INTO app.linkedin_campaign_event(workspace_id,campaign_id,person_id,kind,at) VALUES(p_ws,p.campaign_id,p_person,'expired',p_now) ON CONFLICT DO NOTHING;
 RETURN true;
END $$;
-- The billing exemption only covers the worker writing a LinkedIn person into its own campaign's list.
CREATE OR REPLACE FUNCTION app.billing_guard_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.prospecting_job;job text:=nullif(current_setting('app.billing_job_id',true),'');unit text:='imports';hold text;
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM app.merge_source s JOIN app.merge_record m ON m.workspace_id=s.workspace_id AND m.id=s.merge_id WHERE s.workspace_id=NEW.workspace_id AND s.lead_id=NEW.id AND s.payload=NEW.payload AND m.state='merged' AND m.id=nullif(current_setting('app.lifecycle_undo',true),'')) THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM app.enrichment_delivery d WHERE d.workspace_id=NEW.workspace_id AND d.lead_id=NEW.id AND d.payload=NEW.payload AND d.list_id=NEW.list_id) OR EXISTS(SELECT 1 FROM app.research_person_company pc WHERE pc.workspace_id=NEW.workspace_id AND pc.applied_lead_id=NEW.id AND pc.applied_payload=NEW.payload AND pc.applied_list_id=NEW.list_id) THEN RETURN NEW;END IF;
 -- 07A.2: a lead born from a proven LinkedIn acceptance (or expiry), written by the worker into that campaign's own list;
 -- LinkedIn pricing is per connected account (user decision pending).
 IF session_user='cadence_worker' AND NEW.payload->>'source'='LINKEDIN' AND EXISTS(SELECT 1 FROM app.linkedin_campaign_person lp JOIN app.linkedin_campaign lc ON lc.workspace_id=lp.workspace_id AND lc.id=lp.campaign_id
   WHERE lp.workspace_id=NEW.workspace_id AND lp.lead_id=NEW.id AND NEW.list_id IN(lc.accept_list_id,lc.other_list_id)) THEN RETURN NEW;END IF;
 IF job IS NOT NULL THEN
  SELECT * INTO j FROM app.prospecting_job WHERE workspace_id=NEW.workspace_id AND id=job AND actor_id=current_setting('app.user_id',true) AND lease_token=current_setting('app.billing_job_token',true) AND fence::text=current_setting('app.billing_job_fence',true) AND lease_until>clock_timestamp() AND state IN('running','waiting_provider','cancelling') AND kind='generation';
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_JOB';END IF;
  IF j.created_at<(SELECT cutover_at FROM app.billing_account WHERE workspace_id=NEW.workspace_id) THEN RETURN NEW;END IF;
  unit:=CASE WHEN j.source='APOLLO' THEN 'imports' ELSE 'extractions' END;hold:='job:'||job;
 END IF;
 PERFORM app.billing_consume('lead:'||NEW.id,unit,1,hold);RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.linkedin_release_slot(text,text),app.claim_linkedin_expired(timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_linkedin_expired(timestamptz,integer) TO cadence_worker;
