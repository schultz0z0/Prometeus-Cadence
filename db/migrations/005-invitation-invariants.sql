-- Preserve the newest pending invitation per address; superseded links lose access.
WITH duplicate AS (
 SELECT id,row_number() OVER(PARTITION BY "organizationId",lower(email) ORDER BY "createdAt" DESC,id DESC) AS n FROM auth.invitation WHERE status='pending'
) UPDATE auth.invitation SET status='canceled' WHERE id IN(SELECT id FROM duplicate WHERE n>1);
CREATE UNIQUE INDEX invitation_one_pending_address ON auth.invitation("organizationId",lower(email)) WHERE status='pending';
