-- 07A.2: invite campaigns on the customer's own LinkedIn account. A draft keeps every editor control; activation freezes
-- the revision. One invite per person per account (linkedin_invite_operation), 12 per Brasília day per account in total.
ALTER TABLE app.linkedin_account ADD COLUMN invite_hold_until timestamptz,ADD COLUMN last_invite_at timestamptz,ADD COLUMN accept_checked_at timestamptz;

CREATE TABLE app.linkedin_campaign(
 workspace_id text NOT NULL REFERENCES auth.organization(id),id text NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),draft jsonb NOT NULL,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','active','paused','completed','cancelled')),
 revision bigint NOT NULL DEFAULT 1,account_id text,accept_list_id text,other_list_id text,
 collect_cursor text,collect_done boolean NOT NULL DEFAULT false,collect_token text,collect_lease_until timestamptz,
 last_error text CHECK(length(last_error)<=300),created_by text NOT NULL,activated_by text,activated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES app.linkedin_account(workspace_id,id)
);
CREATE TABLE app.linkedin_campaign_person(
 workspace_id text NOT NULL,campaign_id text NOT NULL,id text NOT NULL,external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 200),
 name text NOT NULL,headline text,company text,location text,profile_url text,degree integer,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','sending','invited','accepted','expired','skipped','failed','uncertain')),
 reason text CHECK(length(reason)<=300),invitation_id text,op_token text,invited_at timestamptz,accepted_at timestamptz,lead_id text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,campaign_id,external_id),
 FOREIGN KEY(workspace_id,campaign_id) REFERENCES app.linkedin_campaign(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX linkedin_person_queue ON app.linkedin_campaign_person(workspace_id,campaign_id,state,created_at);
-- The account's invite ledger: one row per person ever attempted; the day counts toward the account and campaign caps.
CREATE TABLE app.linkedin_invite_operation(
 workspace_id text NOT NULL,account_id text NOT NULL,external_id text NOT NULL,campaign_id text NOT NULL,person_id text NOT NULL,
 state text NOT NULL CHECK(state IN('sending','sent','uncertain','failed')),day date NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,account_id,external_id)
);
CREATE INDEX linkedin_invite_day ON app.linkedin_invite_operation(workspace_id,account_id,day);
CREATE TABLE app.linkedin_campaign_event(
 workspace_id text NOT NULL,campaign_id text NOT NULL,person_id text NOT NULL,kind text NOT NULL CHECK(kind IN('invited','uncertain','accepted','expired')),
 at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workspace_id,person_id,kind)
);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['linkedin_campaign','linkedin_campaign_person','linkedin_invite_operation','linkedin_campaign_event'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker,cadence_dispatcher,cadence_ingress,cadence_billing',t);
END LOOP;END $$;
CREATE POLICY tenant_read ON app.linkedin_campaign FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT(workspace_id,id,name,draft,state,revision,accept_list_id,other_list_id,collect_done,last_error,created_at,updated_at,activated_at) ON app.linkedin_campaign TO cadence_app;
CREATE POLICY tenant_read ON app.linkedin_campaign_person FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT(workspace_id,campaign_id,id,name,headline,company,location,degree,state,reason,invited_at,accepted_at,lead_id,updated_at) ON app.linkedin_campaign_person TO cadence_app;
CREATE POLICY tenant_read ON app.linkedin_campaign_event FOR SELECT USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL);
GRANT SELECT ON app.linkedin_campaign_event TO cadence_app;

CREATE FUNCTION app.linkedin_campaign_actor(p_manage boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r text:=app.lock_membership();
BEGIN
 IF r IS NULL OR r NOT IN('owner','admin','operator') OR (p_manage AND r NOT IN('owner','admin')) THEN RAISE EXCEPTION 'LINKEDIN_CAMPAIGN_ACCESS';END IF;
 RETURN r;
END $$;
-- The live account for exploring and activating: its vendor id stays on the server.
CREATE FUNCTION app.linkedin_live_account() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.linkedin_account;
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=current_setting('app.workspace_id',true) AND state<>'revoked';
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',a.id,'external',a.external_account_id,'state',a.state,'capabilitiesVersion',a.capabilities_version);
END $$;
CREATE FUNCTION app.save_linkedin_campaign(p_id text,p_name text,p_draft jsonb,p_expected bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);c app.linkedin_campaign;
BEGIN
 PERFORM app.linkedin_campaign_actor(false);
 SELECT * INTO c FROM app.linkedin_campaign WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN
  IF p_expected<>0 THEN RAISE EXCEPTION 'LINKEDIN_CAMPAIGN_NOT_FOUND';END IF;
  INSERT INTO app.linkedin_campaign(workspace_id,id,name,draft,created_by) VALUES(ws,p_id,p_name,p_draft,current_setting('app.user_id',true));RETURN 1;
 END IF;
 IF c.revision<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 IF c.state<>'draft' THEN RAISE EXCEPTION 'LINKEDIN_CAMPAIGN_LOCKED';END IF;
 UPDATE app.linkedin_campaign SET name=p_name,draft=p_draft,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id;
 RETURN c.revision+1;
END $$;
-- Owner/admin. Freezes the reviewed revision, binds the live account and creates the destination lists.
CREATE FUNCTION app.activate_linkedin_campaign(p_id text,p_revision bigint,p_account text,p_accept_list text,p_accept_name text,p_other_list text,p_other_name text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);c app.linkedin_campaign;
BEGIN
 SELECT * INTO c FROM app.linkedin_campaign WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_CAMPAIGN_NOT_FOUND';END IF;
 PERFORM app.linkedin_campaign_actor(true);
 IF c.revision<>p_revision THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 IF c.state<>'draft' THEN RAISE EXCEPTION 'LINKEDIN_CAMPAIGN_LOCKED';END IF;
 IF NOT EXISTS(SELECT 1 FROM app.linkedin_account WHERE workspace_id=ws AND id=p_account AND state='ready') THEN RAISE EXCEPTION 'LINKEDIN_CAMPAIGN_BLOCKED';END IF;
 INSERT INTO app.list(workspace_id,id,name) VALUES(ws,p_accept_list,left(p_accept_name,250));
 IF p_other_list IS NOT NULL THEN INSERT INTO app.list(workspace_id,id,name) VALUES(ws,p_other_list,left(p_other_name,250));END IF;
 UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=ws;
 UPDATE app.linkedin_campaign SET state='active',account_id=p_account,accept_list_id=p_accept_list,other_list_id=p_other_list,revision=revision+1,
  activated_by=current_setting('app.user_id',true),activated_at=clock_timestamp(),updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id;
 RETURN c.revision+1;
END $$;
CREATE FUNCTION app.linkedin_campaign_action(p_id text,p_action text,p_expected bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);c app.linkedin_campaign;next text;
BEGIN
 SELECT * INTO c FROM app.linkedin_campaign WHERE workspace_id=ws AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LINKEDIN_CAMPAIGN_NOT_FOUND';END IF;
 PERFORM app.linkedin_campaign_actor(true);
 IF c.revision<>p_expected THEN RAISE EXCEPTION 'REVISION_CONFLICT';END IF;
 next:=CASE WHEN p_action='pause' AND c.state='active' THEN 'paused' WHEN p_action='resume' AND c.state='paused' THEN 'active'
  WHEN p_action='cancel' AND c.state IN('draft','active','paused') THEN 'cancelled' END;
 IF next IS NULL THEN RAISE EXCEPTION 'LINKEDIN_CAMPAIGN_LOCKED';END IF;
 UPDATE app.linkedin_campaign SET state=next,revision=revision+1,updated_at=clock_timestamp() WHERE workspace_id=ws AND id=p_id;
 RETURN c.revision+1;
END $$;

-- Worker: campaigns whose audience still needs collecting (one page per tick, leased 2 min), capped at 500 people.
CREATE FUNCTION app.claim_linkedin_collect(p_token text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE out jsonb;
BEGIN
 WITH due AS(SELECT c.workspace_id,c.id FROM app.linkedin_campaign c JOIN app.linkedin_account a ON a.workspace_id=c.workspace_id AND a.id=c.account_id AND a.state='ready'
   WHERE c.state='active' AND NOT c.collect_done AND (c.collect_lease_until IS NULL OR c.collect_lease_until<=clock_timestamp())
    AND (SELECT count(*) FROM app.linkedin_campaign_person p WHERE p.workspace_id=c.workspace_id AND p.campaign_id=c.id AND p.state='queued')<(c.draft->>'dailyLimit')::int*2
   ORDER BY c.activated_at LIMIT least(greatest(p_limit,1),20) FOR UPDATE OF c SKIP LOCKED),
  leased AS(UPDATE app.linkedin_campaign c SET collect_token=p_token,collect_lease_until=clock_timestamp()+interval '120 seconds' FROM due WHERE c.workspace_id=due.workspace_id AND c.id=due.id
   RETURNING c.workspace_id,c.id,c.draft,c.collect_cursor,c.account_id)
 SELECT coalesce(jsonb_agg(jsonb_build_object('workspaceId',l.workspace_id,'id',l.id,'source',l.draft->'source','cursor',l.collect_cursor,'external',a.external_account_id,'capabilitiesVersion',a.capabilities_version)),'[]') INTO out
  FROM leased l JOIN app.linkedin_account a ON a.workspace_id=l.workspace_id AND a.id=l.account_id;
 RETURN out;
END $$;
-- People already in this account's invite ledger (another campaign) are recorded as skipped, never queued twice.
CREATE FUNCTION app.finish_linkedin_collect(p_ws text,p_id text,p_token text,p_people jsonb,p_cursor text,p_done boolean,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.linkedin_campaign;p jsonb;n integer;
BEGIN
 SELECT * INTO c FROM app.linkedin_campaign WHERE workspace_id=p_ws AND id=p_id AND collect_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF p_error IS NULL THEN
  FOR p IN SELECT * FROM jsonb_array_elements(coalesce(p_people,'[]')) LOOP
   SELECT count(*) INTO n FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND campaign_id=p_id;
   EXIT WHEN n>=500;
   INSERT INTO app.linkedin_campaign_person(workspace_id,campaign_id,id,external_id,name,headline,company,location,profile_url,degree,state,reason)
    SELECT p_ws,p_id,gen_random_uuid()::text,p->>'external',left(p->>'name',200),left(p->>'headline',300),left(p->>'company',200),left(p->>'location',200),left(p->>'profileUrl',500),(p->>'degree')::int,
     CASE WHEN o.external_id IS NULL THEN 'queued' ELSE 'skipped' END,CASE WHEN o.external_id IS NULL THEN NULL ELSE 'Já convidado por outra campanha desta conta.' END
    FROM (SELECT 1) x LEFT JOIN app.linkedin_invite_operation o ON o.workspace_id=p_ws AND o.account_id=c.account_id AND o.external_id=p->>'external'
    ON CONFLICT(workspace_id,campaign_id,external_id) DO NOTHING;
  END LOOP;
  SELECT count(*) INTO n FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND campaign_id=p_id;
 END IF;
 UPDATE app.linkedin_campaign SET collect_cursor=CASE WHEN p_error IS NULL THEN p_cursor ELSE collect_cursor END,collect_done=collect_done OR (p_error IS NULL AND (p_done OR n>=500)),
  last_error=left(p_error,300),collect_token=NULL,collect_lease_until=CASE WHEN p_error IS NULL THEN NULL ELSE clock_timestamp()+interval '15 minutes' END,updated_at=clock_timestamp()
  WHERE workspace_id=p_ws AND id=p_id;
END $$;
-- One invite per call. Per account (serialized by an advisory lock): ready, not held, 20 min since the last invite,
-- under 12 today across campaigns and under the campaign's own daily limit. The ledger row makes one invite per person.
CREATE FUNCTION app.claim_linkedin_invite(p_token text,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE acc record;a app.linkedin_account;pr record;d date:=(p_now AT TIME ZONE 'America/Sao_Paulo')::date;used integer;
BEGIN
 FOR acc IN SELECT DISTINCT c.workspace_id,c.account_id FROM app.linkedin_campaign c WHERE c.state='active' AND c.account_id IS NOT NULL LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('linkedin-invite:'||acc.workspace_id||':'||acc.account_id,0));
  SELECT * INTO a FROM app.linkedin_account WHERE workspace_id=acc.workspace_id AND id=acc.account_id FOR UPDATE;
  CONTINUE WHEN a.state<>'ready' OR a.invite_hold_until>p_now OR a.last_invite_at>p_now-interval '20 minutes';
  SELECT count(*) INTO used FROM app.linkedin_invite_operation WHERE workspace_id=a.workspace_id AND account_id=a.id AND day=d AND state<>'failed';
  CONTINUE WHEN used>=12;
  LOOP
   SELECT p.*,c.draft,c.accept_list_id INTO pr FROM app.linkedin_campaign_person p JOIN app.linkedin_campaign c ON c.workspace_id=p.workspace_id AND c.id=p.campaign_id
    WHERE c.workspace_id=a.workspace_id AND c.account_id=a.id AND c.state='active' AND p.state='queued'
     AND (SELECT count(*) FROM app.linkedin_invite_operation o WHERE o.workspace_id=c.workspace_id AND o.campaign_id=c.id AND o.day=d AND o.state<>'failed')<(c.draft->>'dailyLimit')::int
    ORDER BY c.activated_at,p.created_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED;
   EXIT WHEN NOT FOUND;
   BEGIN
    INSERT INTO app.linkedin_invite_operation(workspace_id,account_id,external_id,campaign_id,person_id,state,day) VALUES(a.workspace_id,a.id,pr.external_id,pr.campaign_id,pr.id,'sending',d);
   EXCEPTION WHEN unique_violation THEN
    UPDATE app.linkedin_campaign_person SET state='skipped',reason='Já convidado por outra campanha desta conta.',updated_at=clock_timestamp() WHERE workspace_id=pr.workspace_id AND id=pr.id;
    CONTINUE;
   END;
   UPDATE app.linkedin_campaign_person SET state='sending',op_token=p_token,updated_at=clock_timestamp() WHERE workspace_id=pr.workspace_id AND id=pr.id;
   UPDATE app.linkedin_account SET last_invite_at=p_now WHERE workspace_id=a.workspace_id AND id=a.id;
   RETURN jsonb_build_object('workspaceId',a.workspace_id,'accountId',a.id,'external',a.external_account_id,'epoch',a.credential_epoch,'capabilitiesVersion',a.capabilities_version,
    'campaignId',pr.campaign_id,'personId',pr.id,'providerId',pr.external_id,'name',pr.name,'company',pr.company,'headline',pr.headline,
    'note',pr.draft->>'note','proof',pr.draft->>'proof','industry',pr.draft->'source'->'industries'->>0);
  END LOOP;
 END LOOP;
 RETURN NULL;
END $$;
-- Right before the call: campaign still active, account still ready on the same epoch. Otherwise the claim is undone.
CREATE FUNCTION app.linkedin_invite_recheck(p_ws text,p_person text,p_token text,p_epoch bigint,p_caps text) RETURNS boolean
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
 RETURN false;
END $$;
-- sent | uncertain (never resent) | failed (refused, stays in the ledger) | skipped (missing fact, not counted) | held (429: back to the queue, account held).
CREATE FUNCTION app.finish_linkedin_invite(p_ws text,p_person text,p_token text,p_outcome text,p_reason text,p_invitation text,p_hold_until timestamptz,p_now timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.linkedin_campaign_person;
BEGIN
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND id=p_person AND op_token=p_token AND state='sending' FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF p_outcome IN('skipped','held') THEN
  DELETE FROM app.linkedin_invite_operation WHERE workspace_id=p_ws AND person_id=p_person AND state='sending';
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
CREATE OR REPLACE FUNCTION app.billing_guard_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.prospecting_job;job text:=nullif(current_setting('app.billing_job_id',true),'');unit text:='imports';hold text;
BEGIN
 IF session_user NOT IN('cadence_app','cadence_worker') THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM app.merge_source s JOIN app.merge_record m ON m.workspace_id=s.workspace_id AND m.id=s.merge_id WHERE s.workspace_id=NEW.workspace_id AND s.lead_id=NEW.id AND s.payload=NEW.payload AND m.state='merged' AND m.id=nullif(current_setting('app.lifecycle_undo',true),'')) THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM app.enrichment_delivery d WHERE d.workspace_id=NEW.workspace_id AND d.lead_id=NEW.id AND d.payload=NEW.payload AND d.list_id=NEW.list_id) OR EXISTS(SELECT 1 FROM app.research_person_company pc WHERE pc.workspace_id=NEW.workspace_id AND pc.applied_lead_id=NEW.id AND pc.applied_payload=NEW.payload AND pc.applied_list_id=NEW.list_id) THEN RETURN NEW;END IF;
 -- 07A.2: a lead born from a proven LinkedIn acceptance (or expiry) is linked first by a definer-only row; LinkedIn pricing is per connected account (user decision pending).
 IF EXISTS(SELECT 1 FROM app.linkedin_campaign_person lp WHERE lp.workspace_id=NEW.workspace_id AND lp.lead_id=NEW.id AND NEW.payload->>'source'='LINKEDIN') THEN RETURN NEW;END IF;
 IF job IS NOT NULL THEN
  SELECT * INTO j FROM app.prospecting_job WHERE workspace_id=NEW.workspace_id AND id=job AND actor_id=current_setting('app.user_id',true) AND lease_token=current_setting('app.billing_job_token',true) AND fence::text=current_setting('app.billing_job_fence',true) AND lease_until>clock_timestamp() AND state IN('running','waiting_provider','cancelling') AND kind='generation';
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_JOB';END IF;
  IF j.created_at<(SELECT cutover_at FROM app.billing_account WHERE workspace_id=NEW.workspace_id) THEN RETURN NEW;END IF;
  unit:=CASE WHEN j.source='APOLLO' THEN 'imports' ELSE 'extractions' END;hold:='job:'||job;
 END IF;
 PERFORM app.billing_consume('lead:'||NEW.id,unit,1,hold);RETURN NEW;
END $$;
-- A LinkedIn person as a lead of a list, deduplicated by the LinkedIn identity in that list.
CREATE FUNCTION app.linkedin_person_lead(p_ws text,p_list text,p_person app.linkedin_campaign_person,p_contact jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lid text;ident text:='linkedin:'||p_person.external_id;
BEGIN
 SELECT lead_id INTO lid FROM app.lead_identity WHERE workspace_id=p_ws AND list_id=p_list AND identity=ident;
 IF lid IS NOT NULL THEN RETURN lid;END IF;
 lid:=gen_random_uuid()::text;
 UPDATE app.linkedin_campaign_person SET lead_id=lid WHERE workspace_id=p_ws AND id=p_person.id;
 INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES(p_ws,lid,p_list,jsonb_strip_nulls(jsonb_build_object('id',lid,'listId',p_list,'name',p_person.name,
  'companyName',p_person.company,'city',p_person.location,'linkedin',p_person.profile_url,'email',p_contact->>'email','phone',p_contact->>'phone',
  'customFields',CASE WHEN p_person.headline IS NULL THEN NULL ELSE jsonb_build_object('cargo',left(p_person.headline,300)) END,
  'qualification','pending','source','LINKEDIN','createdAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));
 INSERT INTO app.lead_identity(workspace_id,list_id,identity,lead_id) VALUES(p_ws,p_list,ident,lid) ON CONFLICT DO NOTHING;
 UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=p_ws;
 RETURN lid;
END $$;
-- Accounts whose relations are due for a check (at most hourly), with the people still waiting for an answer.
CREATE FUNCTION app.claim_linkedin_accept(p_now timestamptz,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE out jsonb;
BEGIN
 WITH due AS(SELECT a.workspace_id,a.id FROM app.linkedin_account a WHERE a.state='ready' AND (a.accept_checked_at IS NULL OR a.accept_checked_at<=p_now-interval '60 minutes')
   AND EXISTS(SELECT 1 FROM app.linkedin_campaign c JOIN app.linkedin_campaign_person p ON p.workspace_id=c.workspace_id AND p.campaign_id=c.id
    WHERE c.workspace_id=a.workspace_id AND c.account_id=a.id AND p.state IN('invited','uncertain'))
   ORDER BY a.accept_checked_at NULLS FIRST LIMIT least(greatest(p_limit,1),20) FOR UPDATE OF a SKIP LOCKED),
  marked AS(UPDATE app.linkedin_account a SET accept_checked_at=p_now FROM due WHERE a.workspace_id=due.workspace_id AND a.id=due.id RETURNING a.*)
 SELECT coalesce(jsonb_agg(jsonb_build_object('workspaceId',m.workspace_id,'accountId',m.id,'external',m.external_account_id,'capabilitiesVersion',m.capabilities_version,
   'waiting',(SELECT jsonb_agg(jsonb_build_object('personId',p.id,'providerId',p.external_id,'enrich',(c.draft->>'enrichOnAccept')::boolean))
     FROM app.linkedin_campaign c JOIN app.linkedin_campaign_person p ON p.workspace_id=c.workspace_id AND p.campaign_id=c.id
     WHERE c.workspace_id=m.workspace_id AND c.account_id=m.id AND p.state IN('invited','uncertain')))),'[]') INTO out FROM marked m;
 RETURN out;
END $$;
-- A proven acceptance (the person is now a relation): once only, one lead in the accept list and one event.
CREATE FUNCTION app.accept_linkedin_person(p_ws text,p_person text,p_contact jsonb,p_now timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.linkedin_campaign_person;c app.linkedin_campaign;lid text;
BEGIN
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND id=p_person FOR UPDATE;
 IF NOT FOUND OR p.state NOT IN('invited','uncertain') THEN RETURN false;END IF;
 SELECT * INTO c FROM app.linkedin_campaign WHERE workspace_id=p_ws AND id=p.campaign_id;
 lid:=app.linkedin_person_lead(p_ws,c.accept_list_id,p,p_contact);
 UPDATE app.linkedin_campaign_person SET state='accepted',accepted_at=p_now,lead_id=lid,reason=NULL,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_person;
 UPDATE app.linkedin_invite_operation SET state='sent' WHERE workspace_id=p_ws AND person_id=p_person AND state='uncertain';
 INSERT INTO app.linkedin_campaign_event(workspace_id,campaign_id,person_id,kind,at) VALUES(p_ws,p.campaign_id,p_person,'accepted',p_now) ON CONFLICT DO NOTHING;
 RETURN true;
END $$;
-- Invites older than the campaign's expiry, to withdraw.
CREATE FUNCTION app.claim_linkedin_expired(p_now timestamptz,p_limit integer) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT jsonb_build_object('workspaceId',p.workspace_id,'personId',p.id,'invitationId',p.invitation_id,'external',a.external_account_id,'capabilitiesVersion',a.capabilities_version) x
  FROM app.linkedin_campaign_person p JOIN app.linkedin_campaign c ON c.workspace_id=p.workspace_id AND c.id=p.campaign_id
  JOIN app.linkedin_account a ON a.workspace_id=c.workspace_id AND a.id=c.account_id AND a.state='ready'
  WHERE p.state='invited' AND p.invitation_id IS NOT NULL AND p.invited_at<=p_now-make_interval(days=>(c.draft->>'expireDays')::int)
  ORDER BY p.invited_at LIMIT least(greatest(p_limit,1),50)) s
$$;
CREATE FUNCTION app.expire_linkedin_person(p_ws text,p_person text,p_now timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.linkedin_campaign_person;c app.linkedin_campaign;lid text;
BEGIN
 SELECT * INTO p FROM app.linkedin_campaign_person WHERE workspace_id=p_ws AND id=p_person FOR UPDATE;
 IF NOT FOUND OR p.state<>'invited' THEN RETURN false;END IF;
 SELECT * INTO c FROM app.linkedin_campaign WHERE workspace_id=p_ws AND id=p.campaign_id;
 IF c.other_list_id IS NOT NULL THEN lid:=app.linkedin_person_lead(p_ws,c.other_list_id,p,'{}'::jsonb);END IF;
 UPDATE app.linkedin_campaign_person SET state='expired',lead_id=lid,updated_at=clock_timestamp() WHERE workspace_id=p_ws AND id=p_person;
 INSERT INTO app.linkedin_campaign_event(workspace_id,campaign_id,person_id,kind,at) VALUES(p_ws,p.campaign_id,p_person,'expired',p_now) ON CONFLICT DO NOTHING;
 RETURN true;
END $$;

DO $$ DECLARE f text;BEGIN FOREACH f IN ARRAY ARRAY['app.linkedin_campaign_actor(boolean)','app.linkedin_live_account()','app.save_linkedin_campaign(text,text,jsonb,bigint)',
 'app.activate_linkedin_campaign(text,bigint,text,text,text,text,text)','app.linkedin_campaign_action(text,text,bigint)','app.claim_linkedin_collect(text,integer)',
 'app.finish_linkedin_collect(text,text,text,jsonb,text,boolean,text)','app.claim_linkedin_invite(text,timestamptz)','app.linkedin_invite_recheck(text,text,text,bigint,text)',
 'app.finish_linkedin_invite(text,text,text,text,text,text,timestamptz,timestamptz)','app.linkedin_person_lead(text,text,app.linkedin_campaign_person,jsonb)',
 'app.claim_linkedin_accept(timestamptz,integer)','app.accept_linkedin_person(text,text,jsonb,timestamptz)','app.claim_linkedin_expired(timestamptz,integer)',
 'app.expire_linkedin_person(text,text,timestamptz)'] LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC';END LOOP;END $$;
GRANT EXECUTE ON FUNCTION app.linkedin_campaign_actor(boolean),app.linkedin_live_account(),app.save_linkedin_campaign(text,text,jsonb,bigint),app.activate_linkedin_campaign(text,bigint,text,text,text,text,text),
 app.linkedin_campaign_action(text,text,bigint) TO cadence_app;
GRANT EXECUTE ON FUNCTION app.claim_linkedin_collect(text,integer),app.finish_linkedin_collect(text,text,text,jsonb,text,boolean,text),app.claim_linkedin_invite(text,timestamptz),
 app.linkedin_invite_recheck(text,text,text,bigint,text),app.finish_linkedin_invite(text,text,text,text,text,text,timestamptz,timestamptz),app.claim_linkedin_accept(timestamptz,integer),
 app.accept_linkedin_person(text,text,jsonb,timestamptz),app.claim_linkedin_expired(timestamptz,integer),app.expire_linkedin_person(text,text,timestamptz) TO cadence_worker;
