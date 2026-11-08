import type {PoolClient} from 'pg';

export async function readExtractionDay(c:PoolClient){
 const {rows}=await c.query(`
  SELECT (p.allowances->>'extractions')::integer/20 AS "limit",
    COALESCE(SUM(x.held+x.spent) FILTER (WHERE r.funding='plan'),0)::integer AS plan,
    COALESCE(SUM(x.held+x.spent) FILTER (WHERE r.funding='credits'),0)::integer AS credits,
    app.billing_extraction_plan_balance() AS "planBalance",
    (SELECT COALESCE(SUM(g.quantity-g.spent-g.held),0)::integer FROM app.billing_grant g
     WHERE g.workspace_id=a.workspace_id AND g.unit='extractions' AND g.source='pack'
       AND NOT g.revoked AND (g.expires_at IS NULL OR g.expires_at>now())) AS "creditsBalance"
  FROM app.billing_account a JOIN app.billing_catalog p ON p.sku=a.plan
  LEFT JOIN app.billing_reservation r ON r.workspace_id=a.workspace_id AND r.unit='extractions'
    AND r.local_day=(now() AT TIME ZONE 'America/Sao_Paulo')::date
  LEFT JOIN app.billing_allocation x ON x.workspace_id=r.workspace_id AND x.key=r.key AND x.unit=r.unit
  WHERE a.workspace_id=current_setting('app.workspace_id',true)
    AND a.state='active' AND a.period_start<=now() AND a.period_end>now()
  GROUP BY a.workspace_id,p.allowances`);
 return (rows[0]??null) as {limit:number;plan:number;credits:number;creditsBalance:number;planBalance:number}|null;
}
