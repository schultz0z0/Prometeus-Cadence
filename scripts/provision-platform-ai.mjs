import path from 'node:path';import {fileURLToPath} from 'node:url';import pg from 'pg';
export async function provisionPlatformAi(pool,env=process.env){
 const workspace=env.PLATFORM_AI_WORKSPACE_ID?.trim(),admins=[...new Set((env.PLATFORM_AI_ADMIN_USER_IDS??'').split(',').map(s=>s.trim()).filter(Boolean))];
 if(!workspace||!admins.length||admins.length>20||![workspace,...admins].every(s=>/^[\w-]{1,120}$/.test(s)))throw Error('Explicit platform AI workspace and administrator user IDs required.');
 const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('platform-ai-control'))");
 const valid=(await c.query('SELECT m."userId" FROM auth.member m JOIN auth.user u ON u.id=m."userId" WHERE m."organizationId"=$1 AND m."userId"=ANY($2::text[]) AND m.role IN(\'owner\',\'admin\') AND u."emailVerified"=true',[workspace,admins])).rows;
 if(valid.length!==admins.length)throw Error('Every designated administrator must be verified and an owner/admin of the control workspace.');
 await c.query('INSERT INTO app.platform_ai_control VALUES(true,$1,$2) ON CONFLICT(singleton) DO UPDATE SET workspace_id=EXCLUDED.workspace_id,admin_user_ids=EXCLUDED.admin_user_ids',[workspace,admins]);await c.query('COMMIT');return{configured:true,administrators:admins.length};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.loadEnvFile('.env.local');const pool=new pg.Pool({connectionString:process.env.MIGRATOR_DATABASE_URL});try{console.log(await provisionPlatformAi(pool));}finally{await pool.end();}
}
