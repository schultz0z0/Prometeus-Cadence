-- Existing revocation/retirement/lease blockers keep their established outcome.
-- Only an otherwise authorized dispatch reaches the new attachment gate.
CREATE OR REPLACE FUNCTION app.begin_message_dispatch(p_ws text,p_message text,p_attempt text,p_token text,p_fence bigint,p_guard jsonb,p_now timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE context jsonb;
BEGIN
 context:=app.read_message_dispatch(p_ws,p_message,p_token,p_fence);
 IF context IS NULL OR context ? 'blocker' THEN RETURN app.begin_message_dispatch_pre_authoring(p_ws,p_message,p_attempt,p_token,p_fence,p_guard,p_now);END IF;
 IF app.read_dispatch_attachments(p_ws,p_message,p_token,p_fence) IS NULL THEN PERFORM app.block_message_dispatch(p_ws,p_message,p_token,p_fence,'ATTACHMENT_AUTHORITY_CHANGED');RETURN jsonb_build_object('allowed',false,'code','ATTACHMENT_AUTHORITY_CHANGED');END IF;
 RETURN app.begin_message_dispatch_pre_authoring(p_ws,p_message,p_attempt,p_token,p_fence,p_guard,p_now);
END $$;
