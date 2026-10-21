import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
const roles={INGRESS:'cadence_ingress',DISPATCH:'cadence_dispatcher'};
export function ensureChannelEnvironment(){
 if(!fs.existsSync('.env.local'))throw Error('Run env:init first.');process.loadEnvFile('.env.local');
 const values={};
 for(const [prefix,role]of Object.entries(roles)){
  const passwordKey=`CADENCE_${prefix}_PASSWORD`,password=process.env[passwordKey]||randomBytes(32).toString('hex');values[passwordKey]=password;
  for(const test of [false,true]){const key=`${test?'TEST_':''}${prefix}_DATABASE_URL`,u=new URL(process.env[`${test?'TEST_':''}MIGRATOR_DATABASE_URL`]);u.username=role;u.password=password;values[key]=u.toString();}
 }
 if(!process.env.CHANNEL_KEYRING_JSON&&!process.env.CHANNEL_ACTIVE_KEY_ID){values.CHANNEL_ACTIVE_KEY_ID='local-v1';values.CHANNEL_KEYRING_JSON=JSON.stringify({'local-v1':randomBytes(32).toString('base64')});}
 const missing=Object.entries(values).filter(([k])=>!process.env[k]);
 if(missing.length)fs.appendFileSync('.env.local','\n'+missing.map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
 for(const [k,v]of missing)process.env[k]=v;
}
export async function provisionChannelRoles(pool){
 const c=await pool.connect();try{
  await c.query("SELECT pg_advisory_lock(hashtext('cadence-channel-role-provision'))");
  for(const [prefix,role]of Object.entries(roles)){
   const password=process.env[`CADENCE_${prefix}_PASSWORD`];if(!password||password.length<32)throw Error('Missing channel role secret');
   if(!(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)await c.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
   await c.query(`ALTER ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${password.replaceAll("'","''")}'`);
  }
 }finally{await c.query("SELECT pg_advisory_unlock(hashtext('cadence-channel-role-provision'))");c.release();}
}
