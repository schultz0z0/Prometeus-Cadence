import 'server-only';
import type {PoolClient} from 'pg';
import type {CompanyProfile} from '../../domain/model.ts';
import type {ContextState,ProductView} from '../../domain/products.ts';
import type {Principal} from '../../domain/workspace.ts';
import {emptyWorkspace} from '../../domain/empty-workspace.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
export async function readApprovedContext(c:PoolClient):Promise<CompanyProfile|null>{
 const rows=(await c.query("SELECT payload FROM app.context_version WHERE payload->>'approvedAt' IS NOT NULL ORDER BY version DESC")).rows;
 // Old context payloads are data, so invalid timestamps do not authorize AI.
 return rows.map(r=>r.payload as CompanyProfile).find(p=>typeof p.approvedAt==='string'&&Number.isFinite(Date.parse(p.approvedAt)))??null;
}
export function productView(row:Record<string,any>):ProductView{return {id:row.id,revision:Number(row.revision),draft:row.draft,approved:row.approved??null,archived:row.archived};}
export async function readContextState(p:Principal):Promise<ContextState>{return withWorkspaceTransaction(p,async c=>{
 const draft=(await c.query('SELECT payload FROM app.context_version ORDER BY version DESC LIMIT 1')).rows[0]?.payload??emptyWorkspace().companyProfile;
 const approved=await readApprovedContext(c),products=(await c.query('SELECT * FROM app.product_profile ORDER BY created_at,id')).rows.map(productView);
 return {draft,approved,products};
});}
