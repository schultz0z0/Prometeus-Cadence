import'server-only';
import type{Principal}from'../../domain/workspace.ts';
import{privacyPolicySchema}from'../../domain/data-lifecycle.ts';
import{withWorkspaceTransaction}from'../db/transaction.ts';
import{getPools}from'../db/pool.ts';
import{AppError}from'../errors.ts';
export type PrivacyView={retention:{active:boolean;sentDays:number;replyDays:number;revision:number;updatedAt:string|null;updatedBy:string|null};canManage:boolean};
const failures:Record<string,[number,string]>={RETENTION_ACCESS:[403,'Só o dono da conta muda esta configuração.'],RETENTION_CONFLICT:[409,'A configuração mudou em outra aba. Recarregue antes de salvar.'],RETENTION_CONFIRM:[422,'Digite APAGAR para confirmar a exclusão do texto antigo.']};
export async function readPrivacy(p:Principal):Promise<PrivacyView>{
 return withWorkspaceTransaction(p,async c=>{
  const role=(await c.query('SELECT app.current_role() role')).rows[0].role;
  if(role!=='owner')return{retention:{active:false,sentDays:365,replyDays:365,revision:0,updatedAt:null,updatedBy:null},canManage:false};
  const r=(await c.query('SELECT * FROM app.retention_policy')).rows[0];
  const name=r?.updated_by?(await getPools().authPool.query('SELECT name FROM "user" WHERE id=$1',[r.updated_by])).rows[0]?.name??null:null;
  return{retention:r?{active:r.active,sentDays:r.sent_days,replyDays:r.reply_days,revision:r.revision,updatedAt:r.updated_at.toISOString(),updatedBy:name}:{active:false,sentDays:365,replyDays:365,revision:0,updatedAt:null,updatedBy:null},canManage:true};
 });
}
export async function savePrivacy(p:Principal,raw:unknown){
 const parsed=privacyPolicySchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Escolha prazos válidos: no mínimo 30 dias para enviadas e 90 para respostas.');const b=parsed.data;
 try{await withWorkspaceTransaction(p,c=>c.query('SELECT app.save_retention_policy($1,$2,$3,$4,$5)',[b.expectedRevision,b.active,b.sentDays,b.replyDays,b.confirm==='APAGAR']));}
 catch(e){const known=e instanceof Error?failures[e.message]:undefined;if(known)throw new AppError(known[0],known[1],(e as Error).message);throw e;}
 return readPrivacy(p);
}
