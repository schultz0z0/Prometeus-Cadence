import {randomUUID} from 'node:crypto';
import {verifiedUser,base} from './helpers.ts';
import {identityAction} from '../../src/server/workspaces/service.ts';
import {requirePrincipal} from '../../src/server/auth/principal.ts';
import {getPools} from '../../src/server/db/pool.ts';
export function configureProspectingTest(){
  Object.assign(process.env,{
    PROSPECTING_ENABLED:'true',CADENCE_RUNTIME_MODE:'local',
    PROSPECTING_WORKSPACE_DAILY_UNITS:JSON.stringify({candidates:1000,apifyRuns:10,apolloPages:10,jevCalls:1000,codexCalls:10}),
    PROSPECTING_GLOBAL_DAILY_UNITS:JSON.stringify({candidates:100000,apifyRuns:1000,apolloPages:1000,jevCalls:100000,codexCalls:1000}),
    APIFY_TOKEN:'fixture-not-a-live-token',APIFY_MAPS_ACTOR:'compass/crawler-google-places',APIFY_MAPS_BUILD:'fixture-build',APIFY_MAX_CHARGE_USD:'0.1',
  });
}
export async function prospectingUser(){
  const u=await verifiedUser();
  const headers=new Headers({cookie:u.cookie,origin:base});
  await identityAction(headers,{type:'create',requestId:randomUUID(),name:'Prospecting QA'});
  const p=await requirePrincipal(headers);
  headers.set('x-cadence-workspace',p.workspaceId);
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
