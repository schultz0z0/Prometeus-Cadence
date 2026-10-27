import {randomUUID} from 'node:crypto';
import {verifiedUser,base} from './helpers.ts';
import {identityAction} from '../../src/server/workspaces/service.ts';
import {requirePrincipal} from '../../src/server/auth/principal.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
export function configureProspectingTest(){
  Object.assign(process.env,{
    PROSPECTING_ENABLED:'true',CADENCE_RUNTIME_MODE:'local',
    PROSPECTING_WORKSPACE_DAILY_UNITS:JSON.stringify({candidates:1000,apifyRuns:10,apolloPages:10,jevCalls:1000,codexCalls:10}),
    PROSPECTING_GLOBAL_DAILY_UNITS:JSON.stringify({candidates:100000,apifyRuns:1000,apolloPages:1000,jevCalls:100000,codexCalls:1000}),
    APIFY_TOKEN:'fixture-not-a-live-token',APIFY_MAPS_ACTOR:'compass/crawler-google-places',APIFY_MAPS_BUILD:'fixture-build',APIFY_MAX_CHARGE_USD:'0.1',
  });
}
export async function prospectingUser(options:{billing?:boolean;platformAi?:boolean}={}){
  const u=await verifiedUser();
  const headers=new Headers({cookie:u.cookie,origin:base});
  await identityAction(headers,{type:'create',requestId:randomUUID(),name:'Prospecting QA'});
  const p=await requirePrincipal(headers);
  if(options.billing!==false)await withWorkspaceTransaction(p,c=>c.query('SELECT app.billing_start_trial($1)',[randomUUID()]));
  headers.set('x-cadence-workspace',p.workspaceId);
  if(options.platformAi){const {configurePlatformAiTest}=await import('./platform-ai-helpers.ts');await configurePlatformAiTest(p);}
  return {...u,headers,p};
}
export const generationInput=()=>({kind:'generation' as const,source:'MAPS' as const,destination:{mode:'new' as const,name:'QA Maps'},filters:{term:'dentistas',location:'São Paulo'},limit:5,dedupScope:'workspace' as const});
export async function countRows(table:string,workspaceId:string){
  if(!['prospecting_job','list','usage_ledger'].includes(table))throw Error('Invalid test table');
  const url=process.env.MIGRATOR_DATABASE_URL!;
  if(!new URL(url).pathname.endsWith('_test'))throw Error('Test database required');
  const {default:pg}=await import('pg'); const pool=new pg.Pool({connectionString:url});
  try{return Number((await pool.query(`SELECT count(*) FROM app.${table} WHERE workspace_id=$1`,[workspaceId])).rows[0].count);}finally{await pool.end();}
}
export async function closeProspectingPools(){await getPools().close();}
export async function seedHybridPolicy(p:import('../../src/domain/workspace.ts').Principal,jobId:string){
 const {configurePlatformAiTest}=await import('./platform-ai-helpers.ts');await configurePlatformAiTest(p);
 Object.assign(process.env,{OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture'});
 const {saveAiPolicy}=await import('../../src/server/prospecting/ai/settings.ts'),{conventionalConfig}=await import('../../src/server/prospecting/ai/config.ts');
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:0,policy:{mode:'auto',conventionalProvider:'openai',jevEnabled:true}});
 const r=conventionalConfig(p.workspaceId).conventional.openai.route;
 await testAdmin(c=>c.query("INSERT INTO app.ai_connection_check(workspace_id,job_id,operation_id,provider,model,config_fingerprint,contract_version,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,'success')",[p.workspaceId,jobId,randomUUID(),r.provider,r.model,r.configFingerprint,r.contractVersion]));
}
export async function testAdmin<T>(fn:(c:import('pg').PoolClient)=>Promise<T>):Promise<T>{
  const url=process.env.MIGRATOR_DATABASE_URL!;
  if(!new URL(url).pathname.endsWith('_test'))throw Error('Test database required');
  const {default:pg}=await import('pg'),pool=new pg.Pool({connectionString:url}),c=await pool.connect();
  try{return await fn(c);}finally{c.release();await pool.end();}
}
export async function grantTestLease(p:import('../../src/domain/workspace.ts').Principal,jobId:string){
  const token=randomUUID();
  return testAdmin(async c=>{
    const r=(await c.query("UPDATE app.prospecting_job SET state='running',lease_owner='test',lease_token=$3,lease_until=now()+interval '5 minutes',fence=fence+1 WHERE workspace_id=$1 AND id=$2 RETURNING fence,lease_until",[p.workspaceId,jobId,token])).rows[0];
    return {workspaceId:p.workspaceId,jobId,actorId:p.userId,token,fence:Number(r.fence),expiresAt:r.lease_until.toISOString()};
  });
}
