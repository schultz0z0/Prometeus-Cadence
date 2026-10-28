-- Runs before085 on upgrades; applied migration checksums remain unchanged.
-- Absent/null steps mean an empty draft, never an active sequence.
UPDATE app.cadence SET payload=jsonb_set(payload,'{steps}','[]'::jsonb)
WHERE NOT(payload ? 'steps') OR payload->'steps'='null'::jsonb;
