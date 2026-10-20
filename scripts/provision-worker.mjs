import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
export function ensureWorkerEnvironment(){
  const file='.env.local';if(!fs.existsSync(file))throw Error('Run env:init first.');
  process.loadEnvFile(file);
  const password=process.env.CADENCE_WORKER_PASSWORD||randomBytes(32).toString('hex');
  const url=(source)=>{const u=new URL(source);u.username='cadence_worker';u.password=password;return u.toString();};
  const values={CADENCE_WORKER_PASSWORD:password,WORKER_DATABASE_URL:url(process.env.MIGRATOR_DATABASE_URL),TEST_WORKER_DATABASE_URL:url(process.env.TEST_MIGRATOR_DATABASE_URL)};
  const missing=Object.entries(values).filter(([key])=>!process.env[key]);
  if(missing.length)fs.appendFileSync(file,'\n'+missing.map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
  for(const [k,v]of missing)process.env[k]=v;
}
export async function provisionWorker(pool){
  const password=process.env.CADENCE_WORKER_PASSWORD;if(!password||password.length<32)throw Error('Missing worker role secret.');
  const c=await pool.connect();
  try{
    await c.query("SELECT pg_advisory_lock(hashtext('cadence-worker-provision'))");
    if(!(await c.query("SELECT 1 FROM pg_roles WHERE rolname='cadence_worker'")).rowCount)await c.query('CREATE ROLE cadence_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
    await c.query("ALTER ROLE cadence_worker NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '"+password.replaceAll("'","''")+"'");
  }finally{await c.query("SELECT pg_advisory_unlock(hashtext('cadence-worker-provision'))");c.release();}
}
