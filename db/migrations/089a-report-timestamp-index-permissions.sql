-- Index expressions execute under the inserting role. This pure parser reads
-- no table and grants no authority over projections or tenant data.
GRANT EXECUTE ON FUNCTION app.report_timestamp(text) TO cadence_app,cadence_worker;
