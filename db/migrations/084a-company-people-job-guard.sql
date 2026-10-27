-- Keep084's applied checksum. Commercial reservation must run after the row's
-- constraints, as before084: an invalid legacy job must fail its own contract
-- rather than reaching a null billing quantity first. The transaction is atomic.
DROP TRIGGER billing_guard_job ON app.prospecting_job;
CREATE TRIGGER billing_guard_job AFTER INSERT ON app.prospecting_job FOR EACH ROW EXECUTE FUNCTION app.billing_guard_job();
