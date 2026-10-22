ALTER TABLE app.channel_connection ADD COLUMN channel text NOT NULL DEFAULT 'WHATSAPP' CHECK(channel IN('WHATSAPP','EMAIL'));
ALTER TABLE app.channel_connection DROP CONSTRAINT channel_connection_provider_check;
ALTER TABLE app.channel_connection ADD CONSTRAINT channel_connection_provider_check CHECK((channel='WHATSAPP' AND provider IN('meta','twilio')) OR(channel='EMAIL' AND provider IN('gmail','smtp-imap')));
ALTER TABLE app.channel_sender ADD COLUMN channel text NOT NULL DEFAULT 'WHATSAPP' CHECK(channel IN('WHATSAPP','EMAIL'));
ALTER TABLE app.channel_sender DROP CONSTRAINT channel_sender_provider_check;
ALTER TABLE app.channel_sender ADD CONSTRAINT channel_sender_provider_check CHECK((channel='WHATSAPP' AND provider IN('meta','twilio')) OR(channel='EMAIL' AND provider IN('gmail','smtp-imap')));
ALTER TABLE app.channel_conversation ADD COLUMN channel text NOT NULL DEFAULT 'WHATSAPP' CHECK(channel IN('WHATSAPP','EMAIL'));
ALTER TABLE app.channel_message ADD COLUMN channel text NOT NULL DEFAULT 'WHATSAPP' CHECK(channel IN('WHATSAPP','EMAIL'));
ALTER TABLE app.channel_message DROP CONSTRAINT channel_message_text_check;
ALTER TABLE app.channel_message ADD CONSTRAINT channel_message_text_check CHECK(text IS NULL OR(channel='WHATSAPP' AND length(text)<=4096) OR(channel='EMAIL' AND octet_length(text)<=65536));

CREATE TABLE app.email_mailbox(
 workspace_id text NOT NULL,id text NOT NULL,provider text NOT NULL CHECK(provider IN('gmail','smtp-imap')),address text CHECK(length(address)<=254),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','authorization_required','verifying','ready','attention','disconnected')),
 signature text NOT NULL DEFAULT '' CHECK(octet_length(signature)<=4096),send_verified boolean NOT NULL DEFAULT false,read_verified boolean NOT NULL DEFAULT false,proof_verified boolean NOT NULL DEFAULT false,
 last_synced_at timestamptz,sync_state text NOT NULL DEFAULT 'baseline' CHECK(sync_state IN('baseline','ready','recovering','error')),
 baseline_at timestamptz,last_error text,bounce_paused boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,id) REFERENCES app.channel_connection(workspace_id,id),
 CHECK(state<>'ready' OR(send_verified AND read_verified AND proof_verified AND baseline_at IS NOT NULL AND sync_state='ready'))
);
CREATE TABLE app.email_oauth_attempt(
 workspace_id text NOT NULL,id text NOT NULL,connection_id text NOT NULL,user_id text NOT NULL,session_hash text NOT NULL,state_hash text NOT NULL UNIQUE,
 revision bigint NOT NULL,envelope jsonb NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,connection_id) REFERENCES app.email_mailbox(workspace_id,id)
);
CREATE TABLE app.email_sync_cursor(
 workspace_id text NOT NULL,mailbox_id text NOT NULL,folder text NOT NULL DEFAULT 'INBOX',cursor jsonb,pending_cursor jsonb,
 revision bigint NOT NULL DEFAULT 1,fence bigint NOT NULL DEFAULT 0,lease_token text,lease_until timestamptz,next_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,mailbox_id,folder),FOREIGN KEY(workspace_id,mailbox_id) REFERENCES app.email_mailbox(workspace_id,id),
 CHECK(cursor IS NULL OR pg_column_size(cursor)<=65536),CHECK(pending_cursor IS NULL OR pg_column_size(pending_cursor)<=65536)
);
CREATE TABLE app.email_thread(
 workspace_id text NOT NULL,id text NOT NULL,mailbox_id text NOT NULL,conversation_id text NOT NULL,thread_key text NOT NULL,subject text NOT NULL DEFAULT '',
 remote_thread_id text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,mailbox_id,thread_key),FOREIGN KEY(workspace_id,mailbox_id) REFERENCES app.email_mailbox(workspace_id,id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES app.channel_conversation(workspace_id,id),CHECK(length(subject)<=1000),CHECK(length(thread_key)<=1000)
);
CREATE TABLE app.email_message(
 workspace_id text NOT NULL,message_id text NOT NULL,mailbox_id text NOT NULL,thread_id text NOT NULL,rfc_message_id text,in_reply_to text,reference_ids jsonb NOT NULL DEFAULT '[]',
 subject text NOT NULL DEFAULT '',from_address text NOT NULL,to_addresses jsonb NOT NULL,origin text NOT NULL CHECK(origin IN('app','external')),
 classification text NOT NULL CHECK(classification IN('human','automatic','dsn','ambiguous')),attachments jsonb NOT NULL DEFAULT '[]',truncated boolean NOT NULL DEFAULT false,
 PRIMARY KEY(workspace_id,message_id),FOREIGN KEY(workspace_id,message_id) REFERENCES app.channel_message(workspace_id,id),FOREIGN KEY(workspace_id,thread_id) REFERENCES app.email_thread(workspace_id,id),
 FOREIGN KEY(workspace_id,mailbox_id) REFERENCES app.email_mailbox(workspace_id,id),CHECK(pg_column_size(attachments)<=65536 AND jsonb_array_length(attachments)<=100),CHECK(pg_column_size(reference_ids)<=65536)
);
CREATE INDEX email_rfc_correlation ON app.email_message(workspace_id,mailbox_id,rfc_message_id);
CREATE TABLE app.email_address_ownership(
 address text PRIMARY KEY,workspace_id text NOT NULL,connection_id text NOT NULL,verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,connection_id) REFERENCES app.email_mailbox(workspace_id,id)
);
CREATE TABLE app.messaging_channel_limits(
 workspace_id text NOT NULL,channel text NOT NULL CHECK(channel IN('EMAIL','WHATSAPP')),daily_limit integer NOT NULL CHECK(daily_limit BETWEEN 1 AND 100000),
 min_interval_seconds integer NOT NULL DEFAULT 60 CHECK(min_interval_seconds BETWEEN 1 AND 86400),max_interval_seconds integer NOT NULL DEFAULT 180 CHECK(max_interval_seconds>=min_interval_seconds AND max_interval_seconds<=86400),
 revision bigint NOT NULL DEFAULT 1,PRIMARY KEY(workspace_id,channel),FOREIGN KEY(workspace_id) REFERENCES auth.organization(id)
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['email_mailbox','email_oauth_attempt','email_sync_cursor','email_thread','email_message','email_address_ownership','messaging_channel_limits'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,cadence_app,cadence_dispatcher,cadence_ingress',t);
  EXECUTE format('CREATE POLICY tenant_read ON app.%I FOR SELECT USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IS NOT NULL)',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['email_mailbox','email_thread','email_message','messaging_channel_limits'] LOOP EXECUTE format('GRANT SELECT ON app.%I TO cadence_app',t);END LOOP;
 FOREACH t IN ARRAY ARRAY['email_mailbox','messaging_channel_limits'] LOOP
  EXECUTE format('CREATE POLICY admin_insert ON app.%I FOR INSERT WITH CHECK(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IN(''owner'',''admin''))',t);
  EXECUTE format('CREATE POLICY admin_update ON app.%I FOR UPDATE USING(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IN(''owner'',''admin'')) WITH CHECK(workspace_id=current_setting(''app.workspace_id'',true) AND app.current_role() IN(''owner'',''admin''))',t);
  EXECUTE format('GRANT INSERT,UPDATE ON app.%I TO cadence_app',t);
 END LOOP;
END $$;
