ALTER TABLE app.ai_policy DROP CONSTRAINT ai_policy_conventional_provider_check;
ALTER TABLE app.ai_policy ADD CONSTRAINT ai_policy_conventional_provider_check
 CHECK (conventional_provider IN ('codex-local','chatgpt-oauth','openai','gemini'));
ALTER TABLE app.ai_connection_check DROP CONSTRAINT ai_connection_check_provider_check;
ALTER TABLE app.ai_connection_check ADD CONSTRAINT ai_connection_check_provider_check
 CHECK (provider IN ('codex-local','chatgpt-oauth','openai','gemini'));
