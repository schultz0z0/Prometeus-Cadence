// Removes exactly what one QA run created, by id: never by a name pattern, which could reach another run or a real workspace.
export async function removeQaAccounts(db,{users,workspaces}){
 const c=await db.connect();
 try{
  const cols=(await c.query("SELECT table_schema s,table_name t,column_name n FROM information_schema.columns WHERE table_schema IN('app','auth') AND column_name IN('workspace_id','organizationId','userId','user_id','actor_id') AND table_name IN(SELECT table_name FROM information_schema.tables WHERE table_schema=columns.table_schema AND table_type='BASE TABLE')".replace('columns.table_schema','information_schema.columns.table_schema'))).rows;
  await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');
  for(const ws of workspaces){for(const {s,t,n} of cols.filter(x=>x.n==='workspace_id'||x.n==='organizationId'))await c.query(`DELETE FROM ${s}."${t}" WHERE "${n}"=$1`,[ws]);await c.query('DELETE FROM auth.organization WHERE id=$1',[ws]);}
  // Foreign keys are off here, so cascades must be done by hand. Only auth tables hold a user's own rows.
  for(const id of users){for(const {t,n} of cols.filter(x=>x.s==='auth'&&['userId','user_id','actor_id'].includes(x.n)))await c.query(`DELETE FROM auth."${t}" WHERE "${n}"=$1`,[id]);await c.query('DELETE FROM auth."user" WHERE id=$1',[id]);}
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 const left=(await db.query('SELECT count(*)::int n FROM auth."user" WHERE id=ANY($1::text[])',[users])).rows[0].n+(await db.query('SELECT count(*)::int n FROM auth.organization WHERE id=ANY($1::text[])',[workspaces])).rows[0].n;
 return left;
}
