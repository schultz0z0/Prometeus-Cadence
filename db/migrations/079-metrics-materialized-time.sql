-- RLS security barriers prevent the application role from exploiting the COALESCE
-- expression index. A stored derived timestamp permits a plain indexed predicate.
ALTER TABLE app.channel_message ADD COLUMN metric_at timestamptz
 GENERATED ALWAYS AS (COALESCE(accepted_at,occurred_at,created_at)) STORED;
DROP INDEX app.channel_message_metric_period;
CREATE INDEX channel_message_metric_period ON app.channel_message(workspace_id,metric_at);
