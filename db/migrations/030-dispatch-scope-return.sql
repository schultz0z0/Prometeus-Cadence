CREATE OR REPLACE FUNCTION app.read_message_dispatch(p_ws text,p_message text,p_token text,p_fence bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE scope_data jsonb;o app.message_outbox;envelope jsonb;
BEGIN
 SELECT m.* INTO o FROM app.message_outbox m WHERE m.workspace_id=p_ws AND m.message_id=p_message AND m.lease_token=p_token AND m.fence=p_fence AND m.lease_until>clock_timestamp() AND m.state='pending';IF NOT FOUND THEN RETURN NULL;END IF;
 scope_data:=app.message_dispatch_scope(p_ws,p_message);IF scope_data ? 'blocker' THEN RETURN scope_data;END IF;
 IF o.publication_id IS NOT NULL AND (scope_data->'publication'->>'state'<>'active' OR scope_data->'enrollment'->>'state'<>'active') THEN RETURN jsonb_build_object('blocker','PUBLICATION_CHANGED');END IF;
 IF scope_data->'connection'->>'state'<>'ready' OR (scope_data->'connection'->>'revision')::bigint<>(o.prepared_send->>'connectionRevision')::bigint THEN RETURN jsonb_build_object('blocker','CONNECTION_CHANGED');END IF;
 SELECT cr.envelope INTO envelope FROM app.channel_credential cr WHERE workspace_id=p_ws AND connection_id=o.connection_id AND revision=(o.prepared_send->>'connectionRevision')::bigint;
 RETURN scope_data||jsonb_build_object('credentialEnvelope',envelope);
END $$;
