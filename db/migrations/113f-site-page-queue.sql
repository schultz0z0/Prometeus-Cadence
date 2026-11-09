CREATE TABLE app.prospecting_site_page (
 workspace_id text NOT NULL,
 job_id text NOT NULL,
 site_key text NOT NULL,
 url text NOT NULL CHECK (length(url) BETWEEN 1 AND 1800),
 kind text NOT NULL CHECK (kind IN ('robots','sitemap','page')),
 priority smallint NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','completed','blocked','failed')),
 claim_fence bigint,
 failures smallint NOT NULL DEFAULT 0,
 retry_at timestamptz NOT NULL DEFAULT '-infinity',
 result jsonb,
 reason text,
 PRIMARY KEY (workspace_id,job_id,site_key,url),
 FOREIGN KEY (workspace_id,job_id) REFERENCES app.prospecting_job(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX prospecting_site_page_frontier ON app.prospecting_site_page
 (workspace_id,job_id,site_key,state,priority,retry_at,url)
 WHERE state IN ('pending','processing');
ALTER TABLE app.prospecting_site_page ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.prospecting_site_page FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.prospecting_site_page FROM PUBLIC;
REVOKE ALL ON app.prospecting_site_page FROM cadence_app;
GRANT SELECT, INSERT, UPDATE ON app.prospecting_site_page TO cadence_worker;

CREATE POLICY site_page_current_job ON app.prospecting_site_page TO cadence_worker USING (
 workspace_id=current_setting('app.workspace_id',true)
 AND job_id=current_setting('app.publication_job',true)
 AND app.journey_publication_allowed(workspace_id,job_id)
 AND EXISTS (
   SELECT 1 FROM app.prospecting_job j
    WHERE j.workspace_id=prospecting_site_page.workspace_id
      AND j.id=prospecting_site_page.job_id
      AND j.actor_id=current_setting('app.user_id',true)
      AND j.lease_token=current_setting('app.publication_token',true)
      AND j.fence::text=current_setting('app.publication_fence',true)
      AND j.state IN ('running','waiting_provider')
      AND j.lease_until>clock_timestamp()
 )
);
