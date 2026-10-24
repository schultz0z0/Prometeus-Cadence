import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
export function ensureBillingEnvironment(){
 if(!fs.existsSync('.env.local'))throw Error('Run env:init first.');process.loadEnvFile('.env.local');
 const values={},secret=process.env.CADENCE_BILLING_PASSWORD||randomBytes(32).toString('hex');values.CADENCE_BILLING_PASSWORD=secret;
 for(const test of [false,true]){const u=new URL(process.env[`${test?'TEST_':''}MIGRATOR_DATABASE_URL`]);u.username='cadence_billing';u.password=secret;values[`${test?'TEST_':''}BILLING_DATABASE_URL`]=u.toString();}
 const missing=Object.entries(values).filter(([k])=>!process.env[k]);if(missing.length)fs.appendFileSync('.env.local','\n'+missing.map(([k,v])=>`${k}=${v}`).join('\n')+'\n');for(const[k,v]of missing)process.env[k]=v;
}
export async function provisionBilling(pool){
 const c=await pool.connect();try{await c.query("SELECT pg_advisory_lock(hashtext('cadence-billing-role'))");const password=process.env.CADENCE_BILLING_PASSWORD;if(!password||password.length<32)throw Error('Missing billing role secret');
 if(!(await c.query("SELECT 1 FROM pg_roles WHERE rolname='cadence_billing'")).rowCount)await c.query('CREATE ROLE cadence_billing LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
 await c.query("ALTER ROLE cadence_billing NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '"+password.replaceAll("'","''")+"'");
 }finally{await c.query("SELECT pg_advisory_unlock(hashtext('cadence-billing-role'))");c.release();}
}
