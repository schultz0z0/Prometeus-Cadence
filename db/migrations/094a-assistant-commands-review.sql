-- 06F.2 review: expiry stops new confirmations only. A proposal already claimed by a confirmation can still be finished
-- after the window, so a job committed just before expiry is recorded instead of leaving the user to ask again.
CREATE OR REPLACE FUNCTION app.assistant_proposal_lock(p_id text,p_for_confirm boolean) RETURNS app.assistant_proposal
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ws text:=current_setting('app.workspace_id',true);uid text:=current_setting('app.user_id',true);r app.assistant_proposal;
BEGIN
 IF app.lock_membership() IS NULL THEN RAISE EXCEPTION 'ASSISTANT_ACCESS';END IF;
 SELECT * INTO r FROM app.assistant_proposal WHERE workspace_id=ws AND user_id=uid AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PROPOSAL_NOT_FOUND';END IF;
 IF r.state='cancelled' THEN RAISE EXCEPTION 'PROPOSAL_CANCELLED';END IF;
 IF r.state='confirmed' AND NOT p_for_confirm THEN RAISE EXCEPTION 'PROPOSAL_DONE';END IF;
 IF r.state='proposed' AND r.confirm_request_id IS NULL AND r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'PROPOSAL_EXPIRED';END IF;
 RETURN r;
END $$;
