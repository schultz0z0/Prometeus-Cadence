-- Delivery provenance is written exclusively by the reviewed SECURITY DEFINER
-- application function. A worker may publish a relationship, never forge a
-- delivered lead and thereby bypass its import quota.
REVOKE INSERT ON app.research_person_company FROM cadence_worker;
GRANT INSERT(workspace_id,case_id,person_id,relationship,current_state) ON app.research_person_company TO cadence_worker;
-- Cached evidence is copied into the new case. Removing the old source company
-- must not block deletion or destroy the independent copied evidence.
ALTER TABLE app.research_company_identity DROP CONSTRAINT research_company_identity_workspace_id_cache_from_fkey;
ALTER TABLE app.research_company_identity ADD CONSTRAINT research_company_identity_workspace_id_cache_from_fkey FOREIGN KEY(workspace_id,cache_from) REFERENCES app.research_company_identity(workspace_id,case_id) ON DELETE SET NULL(cache_from);
