import 'server-only';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {getPools} from './pool.ts';
export async function withWorkspaceTransaction<T>(principal:Principal,fn:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await getPools().appPool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.workspace_id',$1,true),set_config('app.user_id',$2,true)",[principal.workspaceId,principal.userId]);
  const result=await fn(client);await client.query('COMMIT');return result;
 }catch(e){await client.query('ROLLBACK');throw e;}
 finally{client.release();}
}
