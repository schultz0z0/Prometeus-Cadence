CREATE TABLE app.automation_definition (
 workspace_id text NOT NULL,automation_id text NOT NULL,revision bigint NOT NULL CHECK(revision>0),payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,automation_id,revision),
 FOREIGN KEY(workspace_id,automation_id) REFERENCES app.automation(workspace_id,id)
);
CREATE TABLE app.automation_runtime (
 workspace_id text NOT NULL,automation_id text NOT NULL,definition_revision bigint NOT NULL,revision bigint NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'paused' CHECK(status IN('paused','active','blocked')),epoch bigint NOT NULL DEFAULT 0,
 authorization_id text,next_run_at timestamptz,last_run_at timestamptz,blocked_code text,backlog integer NOT NULL DEFAULT 0,
 pending_occurrence_id text,retry_at timestamptz,lease_owner text,lease_token text,lease_until timestamptz,fence bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(workspace_id,automation_id),FOREIGN KEY(workspace_id,automation_id,definition_revision) REFERENCES app.automation_definition(workspace_id,automation_id,revision)
);
CREATE TABLE app.automation_authorization (
 workspace_id text NOT NULL,id text NOT NULL,automation_id text NOT NULL,definition_revision bigint NOT NULL,epoch bigint NOT NULL,
 origin text NOT NULL CHECK(origin IN('schedule','manual')),actor_id text NOT NULL REFERENCES auth."user"(id),payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,automation_id,definition_revision) REFERENCES app.automation_definition(workspace_id,automation_id,revision)
);
CREATE UNIQUE INDEX automation_activation_epoch ON app.automation_authorization(workspace_id,automation_id,epoch) WHERE origin='schedule';
ALTER TABLE app.automation_runtime ADD FOREIGN KEY(workspace_id,authorization_id) REFERENCES app.automation_authorization(workspace_id,id);
CREATE TABLE app.automation_occurrence (
 workspace_id text NOT NULL,id text NOT NULL,automation_id text NOT NULL,definition_revision bigint NOT NULL,authorization_id text NOT NULL,
 origin text NOT NULL CHECK(origin IN('schedule','manual')),request_id text,scheduled_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN('empty','queued','waiting_dependency','running','completed','partial','failed','needs_reconciliation','cancelled','blocked')),
 job_id text,skipped_windows integer NOT NULL DEFAULT 0 CHECK(skipped_windows>=0),blocked_code text,
 counts jsonb NOT NULL DEFAULT '{"found":0,"inserted":0,"duplicates":0,"rejected":0,"pending":0}',created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,automation_id,definition_revision) REFERENCES app.automation_definition(workspace_id,automation_id,revision),
 FOREIGN KEY(workspace_id,authorization_id) REFERENCES app.automation_authorization(workspace_id,id),FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id)
);
CREATE UNIQUE INDEX automation_scheduled_window ON app.automation_occurrence(workspace_id,automation_id,definition_revision,scheduled_at) WHERE origin='schedule';
CREATE UNIQUE INDEX automation_manual_request ON app.automation_occurrence(workspace_id,request_id) WHERE origin='manual';
CREATE INDEX automation_occurrence_history ON app.automation_occurrence(workspace_id,automation_id,created_at DESC,id DESC);
CREATE INDEX automation_occurrence_open ON app.automation_occurrence(workspace_id,automation_id,state) WHERE state IN('queued','running','waiting_dependency','needs_reconciliation');
ALTER TABLE app.automation_runtime ADD FOREIGN KEY(workspace_id,pending_occurrence_id) REFERENCES app.automation_occurrence(workspace_id,id);
CREATE INDEX automation_due ON app.automation_runtime(next_run_at,retry_at,automation_id) WHERE status='active';
CREATE TABLE app.automation_lead_assignment (
 workspace_id text NOT NULL,automation_id text NOT NULL,lead_id text NOT NULL,definition_revision bigint NOT NULL,contract_version text NOT NULL,
 occurrence_id text NOT NULL,job_id text,state text NOT NULL DEFAULT 'assigned' CHECK(state IN('assigned','attempted','pending_review','uncertain','failed','skipped','released')),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,automation_id,lead_id),
 FOREIGN KEY(workspace_id,automation_id,definition_revision) REFERENCES app.automation_definition(workspace_id,automation_id,revision),
 FOREIGN KEY(workspace_id,lead_id) REFERENCES app.lead(workspace_id,id),FOREIGN KEY(workspace_id,occurrence_id) REFERENCES app.automation_occurrence(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id)
);
CREATE INDEX automation_assignment_occurrence ON app.automation_lead_assignment(workspace_id,occurrence_id);
INSERT INTO app.automation_definition(workspace_id,automation_id,revision,payload) SELECT workspace_id,id,1,payload FROM app.automation;
INSERT INTO app.automation_runtime(workspace_id,automation_id,definition_revision) SELECT workspace_id,id,1 FROM app.automation;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['automation_definition','automation_runtime','automation_authorization','automation_occurrence','automation_lead_assignment'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_worker',t);
  EXECUTE format('CREATE POLICY workspace_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
  EXECUTE format('GRANT SELECT ON app.%I TO cadence_app,cadence_worker',t);
 END LOOP;
END $$;
CREATE FUNCTION app.has_automation_write_lease(p_workspace text,p_automation text,p_job text) RETURNS boolean LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT p_workspace=current_setting('app.workspace_id',true) AND app.current_role() IS NOT NULL AND (
 EXISTS(SELECT 1 FROM app.automation_runtime r WHERE r.workspace_id=p_workspace AND r.automation_id=p_automation AND r.lease_token=current_setting('app.automation_token',true) AND r.fence::text=current_setting('app.automation_fence',true) AND r.lease_until>clock_timestamp())
 OR (p_job IS NOT NULL AND EXISTS(SELECT 1 FROM app.prospecting_job j WHERE j.workspace_id=p_workspace AND j.id=p_job AND j.actor_id=current_setting('app.user_id',true) AND j.lease_token=current_setting('app.automation_job_token',true) AND j.fence::text=current_setting('app.automation_job_fence',true) AND j.lease_until>clock_timestamp())));
$$;
REVOKE ALL ON FUNCTION app.has_automation_write_lease(text,text,text) FROM PUBLIC,cadence_app;
GRANT EXECUTE ON FUNCTION app.has_automation_write_lease(text,text,text) TO cadence_worker;
CREATE POLICY worker_update ON app.automation_runtime FOR UPDATE TO cadence_worker USING(app.has_automation_write_lease(workspace_id,automation_id,NULL)) WITH CHECK(app.has_automation_write_lease(workspace_id,automation_id,NULL));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['automation_occurrence','automation_lead_assignment'] LOOP
  EXECUTE format('CREATE POLICY worker_insert ON app.%I FOR INSERT TO cadence_worker WITH CHECK(app.has_automation_write_lease(workspace_id,automation_id,job_id))',t);
  EXECUTE format('CREATE POLICY worker_update ON app.%I FOR UPDATE TO cadence_worker USING(app.has_automation_write_lease(workspace_id,automation_id,job_id)) WITH CHECK(app.has_automation_write_lease(workspace_id,automation_id,job_id))',t);
 END LOOP;
END $$;
GRANT UPDATE ON app.automation_runtime TO cadence_worker;
GRANT INSERT,UPDATE ON app.automation_occurrence,app.automation_lead_assignment TO cadence_worker;
CREATE POLICY manual_insert ON app.automation_occurrence FOR INSERT TO cadence_app WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND origin='manual' AND app.current_role() IN('owner','admin') AND EXISTS(SELECT 1 FROM app.automation_authorization a WHERE a.workspace_id=automation_occurrence.workspace_id AND a.id=authorization_id AND a.origin='manual' AND a.actor_id=current_setting('app.user_id',true)));
CREATE POLICY manual_update ON app.automation_occurrence FOR UPDATE TO cadence_app USING(workspace_id=current_setting('app.workspace_id',true) AND origin='manual' AND app.current_role() IN('owner','admin')) WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND origin='manual' AND app.current_role() IN('owner','admin'));
GRANT INSERT,UPDATE ON app.automation_occurrence TO cadence_app;
CREATE POLICY manual_assignment_insert ON app.automation_lead_assignment FOR INSERT TO cadence_app WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin') AND EXISTS(SELECT 1 FROM app.automation_occurrence o JOIN app.automation_authorization a ON a.workspace_id=o.workspace_id AND a.id=o.authorization_id WHERE o.workspace_id=automation_lead_assignment.workspace_id AND o.id=occurrence_id AND o.origin='manual' AND a.actor_id=current_setting('app.user_id',true)));
CREATE POLICY manual_assignment_update ON app.automation_lead_assignment FOR UPDATE TO cadence_app USING(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin')) WITH CHECK(workspace_id=current_setting('app.workspace_id',true) AND app.current_role() IN('owner','admin'));
GRANT INSERT,UPDATE ON app.automation_lead_assignment TO cadence_app;
GRANT INSERT ON app.audit TO cadence_worker;
GRANT USAGE,SELECT ON SEQUENCE app.audit_id_seq TO cadence_worker;
GRANT EXECUTE ON FUNCTION app.reserve_prospecting_usage(text,text,jsonb,jsonb,jsonb) TO cadence_worker;

CREATE FUNCTION app.sync_automation_definition(p_id text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true); data jsonb; current app.automation_runtime; previous jsonb; version bigint;
BEGIN
 IF app.current_role() NOT IN('owner','admin','operator') OR app.current_role() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT payload INTO data FROM app.automation WHERE workspace_id=ws AND id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'AUTOMATION_MISSING';END IF;
 SELECT * INTO current FROM app.automation_runtime WHERE workspace_id=ws AND automation_id=p_id FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO app.automation_definition VALUES(ws,p_id,1,data,now());INSERT INTO app.automation_runtime(workspace_id,automation_id,definition_revision) VALUES(ws,p_id,1);RETURN 1;
 END IF;
 version:=current.definition_revision;SELECT payload INTO previous FROM app.automation_definition WHERE workspace_id=ws AND automation_id=p_id AND revision=version;
 IF data<>previous THEN version:=version+1;INSERT INTO app.automation_definition VALUES(ws,p_id,version,data,now());END IF;
 UPDATE app.automation_runtime SET definition_revision=version,revision=revision+1,status='paused',epoch=epoch+1,authorization_id=NULL,next_run_at=NULL,pending_occurrence_id=NULL,retry_at=NULL,blocked_code=NULL,lease_token=NULL,lease_until=NULL,fence=fence+1 WHERE workspace_id=ws AND automation_id=p_id;
 RETURN version;
END $$;
CREATE FUNCTION app.authorize_automation(p_id text,p_expected bigint,p_authorization text,p_origin text,p_payload jsonb,p_next timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true); actor text:=current_setting('app.user_id',true); r app.automation_runtime; data jsonb; activation_epoch bigint;
BEGIN
 IF app.current_role() NOT IN('owner','admin') OR app.current_role() IS NULL OR p_origin NOT IN('schedule','manual') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO r FROM app.automation_runtime WHERE workspace_id=ws AND automation_id=p_id FOR UPDATE;
 IF NOT FOUND OR r.revision<>p_expected THEN RAISE EXCEPTION 'AUTOMATION_CHANGED';END IF;
 activation_epoch:=r.epoch+CASE WHEN p_origin='schedule' THEN 1 ELSE 0 END;
 IF p_origin='schedule' AND (p_next IS NULL OR p_next<=clock_timestamp()) THEN RAISE EXCEPTION 'FUTURE_OCCURRENCE_REQUIRED';END IF;
 data:=p_payload||jsonb_build_object('id',p_authorization,'automationId',p_id,'revision',r.definition_revision,'epoch',activation_epoch,'origin',p_origin,'actorId',actor);
 INSERT INTO app.automation_authorization VALUES(ws,p_authorization,p_id,r.definition_revision,activation_epoch,p_origin,actor,data,now());
 IF p_origin='schedule' THEN UPDATE app.automation_runtime SET revision=revision+1,epoch=activation_epoch,status='active',authorization_id=p_authorization,next_run_at=p_next,blocked_code=NULL,retry_at=NULL,lease_token=NULL,lease_until=NULL,fence=fence+1 WHERE workspace_id=ws AND automation_id=p_id;END IF;
 RETURN data;
END $$;
CREATE FUNCTION app.pause_automation(p_id text,p_expected bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);
BEGIN
 IF app.current_role() NOT IN('owner','admin') OR app.current_role() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 UPDATE app.automation_runtime SET status='paused',revision=revision+1,epoch=epoch+1,authorization_id=NULL,next_run_at=NULL,blocked_code=NULL,lease_token=NULL,lease_until=NULL,fence=fence+1 WHERE workspace_id=ws AND automation_id=p_id AND revision=p_expected;
 IF NOT FOUND THEN RAISE EXCEPTION 'AUTOMATION_CHANGED';END IF;
END $$;
REVOKE ALL ON FUNCTION app.sync_automation_definition(text),app.authorize_automation(text,bigint,text,text,jsonb,timestamptz),app.pause_automation(text,bigint) FROM PUBLIC,cadence_worker;
GRANT EXECUTE ON FUNCTION app.sync_automation_definition(text),app.authorize_automation(text,bigint,text,text,jsonb,timestamptz),app.pause_automation(text,bigint) TO cadence_app;

CREATE FUNCTION app.claim_due_automation(p_worker text,p_workspace text DEFAULT NULL) RETURNS TABLE(workspace_id text,automation_id text,actor_id text,token text,expires_at timestamptz,fence bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.automation_runtime; a app.automation_authorization; member_role text; new_token text:=gen_random_uuid()::text;
BEGIN
 IF p_worker IS NULL OR length(p_worker)<1 OR length(p_worker)>120 OR (p_workspace IS NOT NULL AND (length(p_workspace)<1 OR length(p_workspace)>120)) THEN RAISE EXCEPTION 'INVALID_SCHEDULER';END IF;
 SELECT rt.* INTO r FROM app.automation_runtime rt WHERE rt.status='active' AND (p_workspace IS NULL OR rt.workspace_id=p_workspace) AND (rt.lease_until IS NULL OR rt.lease_until<clock_timestamp()) AND (rt.retry_at IS NULL OR rt.retry_at<=clock_timestamp())
  AND (rt.next_run_at<=clock_timestamp() OR rt.pending_occurrence_id IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM app.automation_occurrence o JOIN app.prospecting_job j ON j.workspace_id=o.workspace_id AND j.id=o.job_id WHERE o.workspace_id=rt.workspace_id AND o.automation_id=rt.automation_id AND j.state IN('queued','running','waiting_provider','cancelling','needs_reconciliation'))
  ORDER BY rt.next_run_at NULLS FIRST,rt.automation_id FOR UPDATE OF rt SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO a FROM app.automation_authorization WHERE app.automation_authorization.workspace_id=r.workspace_id AND id=r.authorization_id;
 SELECT m.role INTO member_role FROM auth.member m WHERE m."organizationId"=r.workspace_id AND m."userId"=a.actor_id;
 IF NOT FOUND OR COALESCE(member_role,'') NOT IN('owner','admin') OR a.id IS NULL THEN
  UPDATE app.automation_runtime rt SET status='blocked',blocked_code='AUTHORIZER_REMOVED',next_run_at=NULL,revision=rt.revision+1 WHERE rt.workspace_id=r.workspace_id AND rt.automation_id=r.automation_id;RETURN;
 END IF;
 UPDATE app.automation_runtime rt SET lease_owner=p_worker,lease_token=new_token,lease_until=clock_timestamp()+interval '60 seconds',fence=rt.fence+1 WHERE rt.workspace_id=r.workspace_id AND rt.automation_id=r.automation_id RETURNING rt.fence INTO fence;
 workspace_id:=r.workspace_id;automation_id:=r.automation_id;actor_id:=a.actor_id;token:=new_token;expires_at:=clock_timestamp()+interval '60 seconds';RETURN NEXT;
END $$;
CREATE FUNCTION app.heartbeat_automation(p_id text,p_token text,p_fence bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF length(p_id) NOT BETWEEN 1 AND 120 OR length(p_token) NOT BETWEEN 1 AND 120 OR p_fence<1 THEN RAISE EXCEPTION 'INVALID_SCHEDULER_LEASE';END IF;
 UPDATE app.automation_runtime r SET lease_until=clock_timestamp()+interval '60 seconds' WHERE r.automation_id=p_id AND r.lease_token=p_token AND r.fence=p_fence AND r.lease_until>clock_timestamp() AND r.status='active' AND EXISTS(SELECT 1 FROM app.automation_authorization a JOIN auth.member m ON m."organizationId"=a.workspace_id AND m."userId"=a.actor_id WHERE a.workspace_id=r.workspace_id AND a.id=r.authorization_id AND m.role IN('owner','admin'));RETURN FOUND;
END $$;
CREATE FUNCTION app.ack_automation(p_id text,p_token text,p_fence bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF length(p_id) NOT BETWEEN 1 AND 120 OR length(p_token) NOT BETWEEN 1 AND 120 OR p_fence<1 THEN RAISE EXCEPTION 'INVALID_SCHEDULER_LEASE';END IF;
 UPDATE app.automation_runtime r SET lease_token=NULL,lease_until=NULL,retry_at=GREATEST(COALESCE(r.retry_at,clock_timestamp()),clock_timestamp()+interval '2 seconds') WHERE r.automation_id=p_id AND r.lease_token=p_token AND r.fence=p_fence AND r.lease_until>clock_timestamp();RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION app.claim_due_automation(text,text),app.heartbeat_automation(text,text,bigint),app.ack_automation(text,text,bigint) FROM PUBLIC,cadence_app;
GRANT EXECUTE ON FUNCTION app.claim_due_automation(text,text),app.heartbeat_automation(text,text,bigint),app.ack_automation(text,text,bigint) TO cadence_worker;
