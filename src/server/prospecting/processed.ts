import type {PoolClient} from 'pg';import type {ModuleId,ModuleResult} from '../../domain/prospecting.ts';
import {hashValue} from './review.ts';import {qualificationFingerprint} from '../../domain/qualification-policy.ts';
export async function processedQualifications(c:PoolClient,leadIds:string[],bases:Record<string,unknown>,modules:ModuleId[],contextVersion:number){
 const processed:Record<string,boolean>={},previous=(await c.query("SELECT DISTINCT ON(i.lead_id) i.lead_id,i.payload FROM app.prospecting_item i JOIN app.prospecting_job j ON j.workspace_id=i.workspace_id AND j.id=i.job_id WHERE i.lead_id=ANY($1::text[]) AND i.applied AND j.kind='qualification' AND j.state IN('completed','partial') ORDER BY i.lead_id,j.created_at DESC,i.id DESC",[leadIds])).rows;
 for(const old of previous){const base=bases[old.lead_id] as object;if(base&&old.payload.outputFingerprint===hashValue(qualificationFingerprint(base))&&modules.every(m=>old.payload.results?.some((r:ModuleResult)=>r.module===m&&['succeeded','pending_review'].includes(r.status)&&(r.contextVersion??0)===contextVersion)))processed[old.lead_id]=true;}return processed;
}
