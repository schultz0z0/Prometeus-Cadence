import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {runMigrations} from '../../scripts/db-migrate.mjs';
export async function assertLegacyMailUpgrade(){
 const name='prometeus_upgrade_'+randomBytes(8).toString('hex')+'_test';
 if(!/^prometeus_upgrade_[a-f0-9]{16}_test$/.test(name))throw Error('Invalid upgrade database');
 const source=process.env.MIGRATOR_DATABASE_URL!;if(!new URL(source).pathname.endsWith('_test'))throw Error('Test database required');
 const admin=new pg.Pool({connectionString:source}),target=new URL(source);target.pathname='/'+name;
 const folder=await mkdtemp(path.join(tmpdir(),'prometeus-upgrade-'));let created=false;
 try{
  await admin.query('CREATE DATABASE "'+name+'"');created=true;
  const pool=new pg.Pool({connectionString:target.toString()});
  try{
   await pool.query('CREATE SCHEMA auth AUTHORIZATION cadence_owner;CREATE SCHEMA app AUTHORIZATION cadence_owner;GRANT USAGE ON SCHEMA auth TO cadence_auth;GRANT USAGE ON SCHEMA app TO cadence_app,cadence_worker,cadence_ingress,cadence_dispatcher;');
   const files=(await readdir('db/migrations')).filter(f=>/^\d+.*\.sql$/.test(f)&&Number(f.slice(0,3))<=36);
   for(const file of files)await copyFile(path.join('db/migrations',file),path.join(folder,file));
   await runMigrations(pool,folder);
   await pool.query(`INSERT INTO auth.organization(id,name,slug,"createdAt") VALUES('w','Upgrade','upgrade',now());
INSERT INTO app.list(workspace_id,id,name) VALUES('w','l','L');
INSERT INTO app.cadence(workspace_id,id,list_id,payload) VALUES('w','c','l','{"id":"c","listId":"l"}');
INSERT INTO app.cadence_publication(workspace_id,id,cadence_id,created_by,snapshot) VALUES('w','p','c','u','{"cadence":{"id":"c"},"sender":{"id":"s"},"recipients":[]}');
INSERT INTO app.channel_connection(workspace_id,id,provider,name,public_id,identifiers,created_by) VALUES('w','x','meta','X','upgrade-public-identifier','{}','u');
INSERT INTO app.channel_sender(workspace_id,id,connection_id,provider,external_id,identity_scope) VALUES('w','s','x','meta','1','meta:x');
INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES('w','i','meta:x','2');
INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id) VALUES('w','v','x','s','i');
INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state) VALUES('w','m','x','s','i','v','outbound','accepted');
INSERT INTO app.message_outbox(workspace_id,message_id,connection_id,sender_id,identity_id,actor_id,authority_kind,prepared_send) VALUES('w','m','x','s','i','u','admin','{}');
INSERT INTO app.message_dispatch_attempt(workspace_id,id,message_id,attempt_number,fence,lease_token,state,outcome) VALUES('w','a','m',1,1,'token','accepted','{"kind":"accepted","remoteId":"known"}');`);
   const capture=async()=>JSON.stringify((await pool.query("SELECT (SELECT snapshot FROM app.cadence_publication WHERE id='p') AS snapshot,(SELECT outcome FROM app.message_dispatch_attempt WHERE id='a') AS receipt")).rows[0]);
   const before=await capture();await copyFile('db/migrations/037-email-mailboxes.sql',path.join(folder,'037-email-mailboxes.sql'));await runMigrations(pool,folder);
   assert.equal(await capture(),before);assert.equal((await pool.query("SELECT channel FROM app.channel_sender WHERE id='s'")).rows[0].channel,'WHATSAPP');
  }finally{await pool.end();}
 }finally{
  if(created)await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');await admin.end();
  const resolved=path.resolve(folder),root=path.resolve(tmpdir())+path.sep;
  if(!resolved.startsWith(root)||!path.basename(resolved).startsWith('prometeus-upgrade-'))throw Error('Unsafe fixture cleanup');
  await rm(resolved,{recursive:true,force:true});
 }
}
