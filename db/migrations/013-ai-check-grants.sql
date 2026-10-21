-- Override installation default privileges: customers may read attestations, never forge them.
REVOKE INSERT,UPDATE,DELETE ON app.ai_connection_check FROM cadence_app;
REVOKE DELETE ON app.ai_policy FROM cadence_app;
