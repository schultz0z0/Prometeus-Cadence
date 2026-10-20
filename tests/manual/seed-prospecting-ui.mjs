// Private UI fixture harness: no API route, no provider fallback, no external requests.
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
process.loadEnvFile('.env.local');
if(!process.argv.includes('--local-qa'))throw Error('Explicit --local-qa required.');
const url=new URL(process.env.MIGRATOR_DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Local database required.');
const pool=new pg.Pool({connectionString:url.toString()}),c=await pool.connect();
try{
  await c.query('BEGIN');
  const actor=(await c.query('SELECT id FROM auth."user" WHERE email=$1 AND "emailVerified"=true',['marco02-1792524180610@cadence.example'])).rows[0];
  if(!actor)throw Error('Dedicated verified QA account required.');
  const ws=randomUUID(),list=randomUUID(),lead=randomUUID(),now=new Date().toISOString();
  await c.query('INSERT INTO auth.organization(id,name,slug,"createdAt") VALUES($1,$2,$3,now())',[ws,'QA · Marco 03 · fixtures',ws]);
  await c.query('INSERT INTO auth.member VALUES($1,$2,$3,\'owner\',now())',[randomUUID(),ws,actor.id]);
  await c.query('INSERT INTO app.workspace_meta VALUES($1,1)',[ws]);
  await c.query('INSERT INTO app.list VALUES($1,$2,$3)',[ws,list,'QA · empresas sintéticas']);
  const payload={id:lead,listId:list,name:'QA Clínica Sintética',site:'https://example.com/',source:'MANUAL',qualification:'pending',createdAt:now};
  await c.query('INSERT INTO app.lead VALUES($1,$2,$3,$4)',[ws,lead,list,payload]);
  const jobs={};
  for(const state of ['partial','queued','needs_reconciliation','completed']){
    const id=randomUUID();jobs[state]=id;const qualification=state==='completed';
    const input=qualification?{kind:'qualification',listId:list,leadIds:[lead],modules:['email'],summaryPolicy:'all',escalation:'off'}:{kind:'generation',source:'MAPS',destination:{mode:'existing',listId:list},filters:{term:'fixture',location:'QA'},limit:2,dedupScope:'workspace'};
    await c.query('INSERT INTO app.prospecting_job(workspace_id,id,actor_id,list_id,request_id,body_hash,kind,source,state,input,profile_version,checkpoint,counts) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[ws,id,actor.id,list,randomUUID(),'fixture',input.kind,qualification?'QUALIFY':'MAPS',state,input,'fixture',{fixture:true,context:null,bases:{[lead]:payload}},{found:1,inserted:qualification?0:1,duplicates:0,rejected:0,pending:qualification?1:0}]);
    if(qualification){
      const evidenceId=randomUUID();
      await c.query('INSERT INTO app.lead_evidence VALUES($1,$2,$3,$4,$5,$6,$7,false,now())',[ws,evidenceId,lead,id,'https://example.com/','Fixture sintética: contato qa@example.com','fixture']);
      await c.query('INSERT INTO app.prospecting_item(workspace_id,job_id,id,lead_id,name,status,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[ws,id,randomUUID(),lead,payload.name,'pending_review',{results:[{module:'email',status:'pending_review',proposed:{email:'qa@example.com'},base:{email:null},reasons:['QA_SYNTHETIC_FIXTURE'],evidenceIds:[evidenceId],usage:null,contextVersion:0}]}]);
    }
  }
  await c.query('COMMIT');
  const result={workspaceId:ws,listId:list,leadId:lead,jobs};
  await fs.writeFile('.superpowers/sdd/2026-10-20-prometeus-cadence-03-prospecting/ui-fixtures.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();await pool.end();}
