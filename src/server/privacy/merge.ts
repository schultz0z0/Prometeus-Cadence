import'server-only';
import type{PoolClient}from'pg';
import type{Principal}from'../../domain/workspace.ts';
import type{Reviewed}from'../../domain/reviewed-operation.ts';
import{mergeConfirmSchema,mergePrepareSchema,undoSchema,type MergeGroup,type MergeView}from'../../domain/data-lifecycle.ts';
import{withWorkspaceTransaction}from'../db/transaction.ts';
import{requirePermission}from'../auth/permissions.ts';
import{AppError}from'../errors.ts';
import{createReviewToken,hashValue,verifyReviewToken}from'../prospecting/review.ts';
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
const failures:Record<string,[number,string]>={
 LIFECYCLE_ACCESS:[403,'Você não tem mais acesso a este workspace.'],
 MERGE_CHANGED:[409,'Os contatos mudaram desde a busca. Procure duplicados de novo.'],
 MERGE_INVALID:[422,'Grupo de fusão inválido.'],
 MERGE_REPLAY_CHANGED:[409,'Esta operação já foi utilizada com outros dados.'],
 MERGE_CONFLICT_CADENCE:[409,'Dois contatos do grupo estão na mesma cadência. Remova um deles da cadência antes de fundir.'],
 MERGE_CONFLICT_ENRICHMENT:[409,'Mais de um contato do grupo veio do enriquecimento de decisores. Revise-os manualmente.'],
 MERGE_CONFLICT_RESEARCH:[409,'Um contato que seria apagado tem investigação de empresa própria. Revise-o manualmente.'],
 MERGE_NOT_FOUND:[404,'Fusão não encontrada.'],
 MERGE_ALREADY_UNDONE:[409,'Esta fusão já foi desfeita.'],
 MERGE_EXPIRED:[409,'O prazo de 7 dias para desfazer esta fusão terminou.'],
 MERGE_CONFLICT:[409,'O contato principal ou os vínculos mudaram depois da fusão. Desfazer agora sobrescreveria mudanças novas.'],
};
export function lifecycleError(e:unknown){const known=e instanceof Error?failures[e.message]:undefined;return known?new AppError(known[0],known[1],e instanceof Error?e.message:undefined):e;}
const fields="l.id,l.list_id,l.payload->>'name' AS name,l.payload->>'email' AS email,l.payload->>'phone' AS phone,l.payload->>'cnpj' AS cnpj,li.name AS list_name";
type Lead={id:string;name:string;email:string|null;phone:string|null;cnpj:string|null;listName:string|null};
async function leads(c:PoolClient,ids:string[]){
 const rows=(await c.query(`SELECT ${fields},md5(l.payload::text) AS hash FROM app.lead l LEFT JOIN app.list li ON li.workspace_id=l.workspace_id AND li.id=l.list_id WHERE l.id=ANY($1::text[])`,[ids])).rows;
 return new Map(rows.map(r=>[r.id as string,{lead:{id:r.id,name:r.name??'',email:r.email,phone:r.phone,cnpj:r.cnpj,listName:r.list_name} as Lead,hash:r.hash as string}]));
}
export async function scanDuplicates(p:Principal){
 return withWorkspaceTransaction(p,async c=>{
  const groups=(await c.query('SELECT * FROM app.scan_duplicate_leads()')).rows as {kind:'cnpj'|'email'|'phone';value:string;ids:string[]}[];
  const all=await leads(c,groups.flatMap(g=>g.ids));
  return{groups:groups.map(g=>({kind:g.kind,value:g.value,ids:g.ids,leads:g.ids.map(id=>all.get(id)!.lead)}))};
 });
}
async function basis(c:PoolClient,groups:MergeGroup[]){
 const ids=[...new Set(groups.flatMap(g=>[g.targetId,...g.sourceIds]))],found=await leads(c,ids),blockers:string[]=[];
 if(found.size!==ids.length)blockers.push('Algum contato do grupo não existe mais. Procure duplicados de novo.');
 const keys=(await c.query("SELECT l.id,x.kind,app.lead_key(x.kind,l.payload->>app.lead_key_field(x.kind)) AS value FROM app.lead l CROSS JOIN(VALUES('cnpj'),('email'),('phone')) x(kind) WHERE l.id=ANY($1::text[])",[ids])).rows;
 for(const g of groups)for(const id of[g.targetId,...g.sourceIds])if(!keys.some(k=>k.id===id&&k.kind===g.kind&&k.value===g.value))blockers.push('Um grupo não compartilha mais a mesma chave forte.');
 return{hash:hashValue({groups,leads:ids.map(id=>[id,found.get(id)?.hash??null])}),blockers:[...new Set(blockers)]};
}
const proof=(p:Principal,groups:MergeGroup[],hash:string)=>({action:'leads.merge',userId:p.userId,workspaceId:p.workspaceId,groups,basisHash:hash});
export async function prepareMerge(p:Principal,raw:unknown):Promise<Reviewed<{groups:MergeGroup[]}>&{removed:number}>{
 const parsed=mergePrepareSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Selecione grupos de duplicados válidos.');const input=parsed.data;
 requirePermission(p,'data.write');
 return withWorkspaceTransaction(p,async c=>{const b=await basis(c,input.groups);return{input,token:createReviewToken(proof(p,input.groups,b.hash),secret()),expiresAt:new Date(Date.now()+600000).toISOString(),basisHash:b.hash,blockers:b.blockers,
  warnings:['O contato mais antigo de cada grupo fica e recebe o que faltava nele. Os outros saem da base e podem voltar com Desfazer por 7 dias.'],removed:input.groups.reduce((n,g)=>n+g.sourceIds.length,0)};});
}
export async function confirmMerge(p:Principal,raw:unknown){
 const parsed=mergeConfirmSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Revise os grupos antes de fundir.');const body=parsed.data;
 requirePermission(p,'data.write');
 await withWorkspaceTransaction(p,async c=>{const b=await basis(c,body.groups);
  // A replay after success finds the merged sources gone; the merge records themselves prove it.
  const done=(await c.query('SELECT count(*)::int n FROM app.merge_record WHERE request_id=$1 AND actor_id=$2',[body.requestId,p.userId])).rows[0].n;
  if(!done){try{verifyReviewToken(body.token,proof(p,body.groups,b.hash),secret());}catch{throw new AppError(409,'Os contatos mudaram desde a revisão. Procure duplicados de novo.','MERGE_CHANGED');}if(b.blockers.length)throw new AppError(409,b.blockers[0],'MERGE_CHANGED');}
 });
 const merged:string[]=[],failed:{targetId:string;message:string}[]=[];
 // One transaction per group: a conflicting group fails alone and never leaves a partial merge.
 for(const g of body.groups){
  try{merged.push(await withWorkspaceTransaction(p,async c=>(await c.query('SELECT app.merge_lead_group($1,$2,$3,$4,$5) id',[body.requestId,g.targetId,g.sourceIds,g.kind,g.value])).rows[0].id));}
  catch(e){const err=lifecycleError(e);if(!(err instanceof AppError)||err.status===403)throw err;failed.push({targetId:g.targetId,message:err.message});}
 }
 return{merged:merged.length,mergeIds:merged,failures:failed};
}
export async function listMerges(p:Principal){
 return withWorkspaceTransaction(p,async c=>(await c.query("SELECT id,kind,key_value,state,created_at,undo_until,undone_at,revision FROM app.merge_record ORDER BY created_at DESC,id LIMIT 20")).rows.map(r=>({id:r.id,kind:r.kind,value:r.key_value,state:r.state,createdAt:r.created_at.toISOString(),undoUntil:r.undo_until.toISOString(),undoneAt:r.undone_at?.toISOString()??null,revision:r.revision,canUndo:r.state==='merged'&&r.undo_until>new Date()})));
}
export async function undoMerge(p:Principal,mergeId:string,raw:unknown):Promise<MergeView>{
 const parsed=undoSchema.safeParse(raw);if(!parsed.success||!/^[0-9a-f-]{36}$/.test(mergeId))throw new AppError(422,'Identifique a fusão antes de desfazer.');
 requirePermission(p,'data.write');
 try{return await withWorkspaceTransaction(p,async c=>{await c.query('SELECT app.undo_lead_merge($1,$2)',[mergeId,parsed.data.requestId]);const r=(await c.query('SELECT state,undo_until FROM app.merge_record WHERE id=$1',[mergeId])).rows[0];return{id:mergeId,state:r.state,undoUntil:r.undo_until.toISOString()};});}
 catch(e){throw lifecycleError(e);}
}
