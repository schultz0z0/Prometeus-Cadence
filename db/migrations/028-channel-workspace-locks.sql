-- An empty workspace can connect a channel before saving its first domain command.
-- Preserve existing revisions; ensure that the common tenant serialization row exists.
INSERT INTO app.workspace_meta(workspace_id)
 SELECT DISTINCT workspace_id FROM app.channel_connection
 ON CONFLICT(workspace_id) DO NOTHING;
