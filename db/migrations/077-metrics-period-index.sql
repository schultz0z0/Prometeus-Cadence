CREATE INDEX channel_message_metric_period ON app.channel_message(workspace_id,(COALESCE(accepted_at,occurred_at,created_at)));
CREATE INDEX contact_suppression_metric_period ON app.contact_suppression(workspace_id,created_at);
CREATE INDEX email_bounce_metric_period ON app.email_bounce(workspace_id,created_at);
