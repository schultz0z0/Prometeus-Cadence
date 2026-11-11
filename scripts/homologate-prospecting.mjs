// Homologação real por módulo (06B.6e / 06IA-H): Gerador por fonte, Qualificador e Enriquecedor.
// Usa uma conta [RE] descartável com sessão real do app e o worker contínuo. Chama fornecedores pagos.
// QA_PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs QA_CHROME_PATH=... node --experimental-strip-types scripts/homologate-prospecting.mjs --confirm-provider-cost [--limit=3] [--keep]
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {removeQaAccounts} from '../tests/manual/qa-cleanup.mjs';
if(!process.argv.includes('--confirm-provider-cost'))throw Error('Explicit provider cost acknowledgement required.');
process.loadEnvFile('.env.local');
const limit=Number(process.argv.find(a=>a.startsWith('--limit='))?.slice(8)??3);assert.ok(limit>=1&&limit<=5,'limit 1..5');
const origin='http://127.0.0.1:3210',out='output/homologation';mkdirSync(out,{recursive:true});
const url=new URL(process.env.MIGRATOR_DATABASE_URL);if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Local database required.');
const db=new pg.Pool({connectionString:url.toString()});
const {chromium}=await import(process.env.QA_PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROME_PATH});
const report={date:new Date().toISOString(),limit,rounds:[]},stamp=Date.now();
const email=`re-qa-08a-hml-${stamp}@example.com`,password='Local-HML-'+randomUUID();
let created=null;
const mailLink=async()=>{for(let i=0;i<30;i++){const box=await (await fetch(`http://127.0.0.1:8125/api/v2/search?kind=to&query=${encodeURIComponent(email)}`)).json();for(const m of box.items??[]){const t=m.Content.Body.replace(/=\r?\n/g,'').replace(/=([A-Fa-f0-9]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16)));const l=(t.match(/https?:\/\/[^\s<>"]+/g)??[]).find(x=>x.includes('verify-email'));if(l)return l;}await new Promise(w=>setTimeout(w,500));}throw Error('no mail link');};
try{
 let r;for(let i=0;i<8;i++){r=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({registration:{phone:'(21) 97323-1943',accepted:true,termsVersion:'homologacao-2026-10-26-v2',privacyVersion:'homologacao-2026-10-26-v2'},name:'[RE] HML 06B.6e',email,password,callbackURL:origin+'/onboarding/workspace'})});if(r.status!==429)break;await new Promise(w=>setTimeout(w,70000));}
 if(!r.ok)throw Error('signup '+r.status);
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
 await page.goto(await mailLink(),{waitUntil:'load',timeout:120000});
 await page.getByText('Carregando sua conta').waitFor({state:'hidden',timeout:60000}).catch(()=>{});await page.waitForTimeout(1500);
 await page.getByPlaceholder('Sua empresa').fill('[RE] HML 06B.6e');await page.getByRole('button',{name:/Criar workspace/}).click();await page.waitForURL(u=>!u.pathname.includes('onboarding/workspace'),{timeout:120000});
 const row=(await db.query('SELECT m."organizationId" AS ws,u.id FROM auth."user" u JOIN auth.member m ON m."userId"=u.id WHERE u.email=$1',[email])).rows[0];created=row;const ws=row.ws;
 // Conta de homologação: plano Essential ativo por 7 dias, saldo pequeno e contexto aprovado da empresa.
 await db.query("UPDATE app.billing_account SET state='active',plan='essential',period_start=now(),period_end=now()+interval '7 days' WHERE workspace_id=$1",[ws]);
 for(const [unit,q] of [['extractions',limit*4],['enrichment',limit]])await db.query("INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref,expires_at) VALUES($1,$2,$3,$4,'plan',$2,now()+interval '7 days')",[ws,randomUUID(),unit,q]);
 await db.query('INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,1,$2)',[ws,{version:1,approvedAt:new Date().toISOString(),offer:'Desenvolvimento de software, criação de sites e automações com IA para pequenas e médias empresas',idealCustomer:'Clínicas e empresas de serviços locais que dependem de agendamento e atendimento online e ainda têm presença digital fraca'}]);
 const headers={origin,'content-type':'application/json','x-cadence-workspace':ws};
 const call=async(path,data)=>{const res=data===undefined?await page.request.get(origin+'/api/prospecting'+path,{headers}):await page.request.post(origin+'/api/prospecting'+path,{headers,data});const body=await res.json().catch(()=>({}));if(!res.ok())throw Error(path+' '+res.status()+' '+(body.message??''));return body;};
 const terminal=['completed','partial','failed','cancelled','needs_reconciliation'];
 async function run(name,input,minutes=10){
  const round={name,input:{...input,leadIds:input.leadIds?.length},started:new Date().toISOString()};report.rounds.push(round);const t=Date.now();
  try{
   const review=await call('/prepare',input);round.blockers=review.blockers;round.estimate=review.usage;
   if(review.blockers?.length){round.state='blocked';console.log(name,'BLOQUEADO',review.blockers.join(' | '));return round;}
   let job=await call('/jobs',{requestId:randomUUID(),input:review.input,reviewToken:review.token});round.jobId=job.id;
   while(!terminal.includes(job.state)&&Date.now()-t<minutes*60000){await new Promise(w=>setTimeout(w,5000));job=await call('/jobs/'+job.id);}
   Object.assign(round,{state:job.state,counts:job.counts,usage:job.usage,error:job.error??null,discoveryReasons:job.discoveryReasons??null,seconds:Math.round((Date.now()-t)/1000)});
   if(!terminal.includes(job.state)){await call('/jobs/'+job.id+'/cancel',{}).catch(()=>{});round.timedOut=true;}
   round.items=(await call('/jobs/'+job.id+'/items')).items??[];
  }catch(e){round.state='error';round.error=String(e.message).slice(0,300);}
  console.log(name,round.state,JSON.stringify(round.counts??{}),(round.seconds??0)+'s',round.error?JSON.stringify(round.error):'');return round;
 }
 const leadsOf=async listId=>(await db.query('SELECT id,payload FROM app.lead WHERE workspace_id=$1 AND list_id=$2 ORDER BY id',[ws,listId])).rows;
 const shape=rows=>rows.map(l=>Object.fromEntries(['name','phone','site','cnpj','email','city','address'].map(k=>[k,k==='name'?l.payload.name:!!l.payload[k]])));
 const gen=(source,filters)=>({kind:'generation',source,destination:{mode:'new',name:'[RE] HML '+source},filters,limit,dedupScope:'workspace',funding:'plan'});
 const lists={};
 const only=process.argv.find(a=>a.startsWith('--sources='))?.slice(10).split(',');
 for(const [source,filters] of [['MAPS',{term:'clínica odontológica',location:'Curitiba, PR'}],['CNPJ',process.argv.includes('--software')?{term:'software',location:'Curitiba',includeCnae:'6201501',states:'PR'}:{term:'esquadrias',location:'Curitiba',includeCnae:'2512800',states:'PR'}],['WEB',{term:'escritório de contabilidade',location:'Curitiba, PR'}]]){
  if(only&&!only.includes(source))continue;
  const round=await run('gerador:'+source,gen(source,filters));
  if(round.jobId){const listId=(await db.query('SELECT list_id FROM app.prospecting_job WHERE id=$1',[round.jobId])).rows[0]?.list_id;if(listId){lists[source]=listId;round.leads=shape(await leadsOf(listId));}}
  delete round.items;
 }
 // --seed=file.json: leads conhecidos (nome, site, cnpj, cidade) numa lista própria, para medir o Enriquecedor sem depender do Gerador.
 const seedFile=process.argv.find(a=>a.startsWith('--seed='))?.slice(7);
 if(seedFile){const listId=randomUUID();await db.query('INSERT INTO app.list VALUES($1,$2,$3)',[ws,listId,'[RE] HML semente']);for(const l of JSON.parse((await import('node:fs')).readFileSync(seedFile,'utf8'))){const id=randomUUID();await db.query('INSERT INTO app.lead VALUES($1,$2,$3,$4)',[ws,id,listId,{id,listId,source:'MANUAL',qualification:'pending',createdAt:new Date().toISOString(),...l}]);}lists.SEED=listId;}
 const summarize=items=>items.map(i=>({name:i.name,status:i.status,modules:(i.results??[]).map(r=>({module:r.module,status:r.status,reasons:r.reasons,proposed:Object.keys(r.proposed??{}),evidence:(r.evidenceIds??[]).length})),people:i.enrichment?.people?.length,charged:i.enrichment?.charged}));
 // Qualificador: lista do Maps (sem CNPJ) com descoberta de site, contatos, cadastro, aderência e resumo por IA.
 if(lists.MAPS){const leads=await leadsOf(lists.MAPS);if(leads.length){const round=await run('qualificador:MAPS',{kind:'qualification',listId:lists.MAPS,leadIds:leads.map(l=>l.id),modules:['website','email','phone','registry','qualify','summary'],summaryPolicy:'all',escalation:'off'},15);const items=round.items??[];round.results=summarize(items);delete round.items;
   const applicable=items.filter(i=>(i.results??[]).some(r=>r.status==='pending_review')).map(i=>i.id);
   if(applicable.length&&round.jobId)try{round.applied=await call('/jobs/'+round.jobId+'/apply',{requestId:randomUUID(),itemIds:applicable});round.leadsAfter=shape(await leadsOf(lists.MAPS));}catch(e){round.applyError=String(e.message).slice(0,200);}}}
 // Enriquecedor: qualquer lead com CNPJ válido; primeiro a lista da Base CNPJ, depois a do Maps se a qualificação achou CNPJ.
 const valid=l=>/^[A-Z0-9]{12}[0-9]{2}$/.test(String(l.payload.cnpj??'').replace(/[.\/\s-]/g,'').toUpperCase());
 for(const source of ['CNPJ','MAPS','SEED']){if(!lists[source])continue;const leads=(await leadsOf(lists[source])).filter(valid).slice(0,3);if(!leads.length){report.rounds.push({name:'enriquecedor:'+source,state:'sem lead com CNPJ'});console.log('enriquecedor:'+source,'sem lead com CNPJ');continue;}
  const round=await run('enriquecedor:'+source,{kind:'qualification',listId:lists[source],leadIds:leads.map(l=>l.id),modules:['decisors'],summaryPolicy:'all',escalation:'off',enrichment:{maxCredits:leads.length,destinationName:'[RE] HML Decisores '+source}},15);round.results=summarize(round.items??[]);delete round.items;}
 report.billing=(await db.query('SELECT unit,sum(quantity)::int AS consumed FROM app.billing_consumption WHERE workspace_id=$1 GROUP BY unit',[ws])).rows;
 report.reservations=(await db.query('SELECT unit,count(*)::int AS open FROM app.billing_reservation WHERE workspace_id=$1 AND NOT closed GROUP BY unit',[ws])).rows;
 await context.close();
}finally{
 const file=`${out}/06b6e-${stamp}.json`;writeFileSync(file,JSON.stringify(report,null,1));console.log('report',file);
 if(created&&!process.argv.includes('--keep')){const residue=await removeQaAccounts(db,{users:[created.id],workspaces:[created.ws],emails:[email]});console.log('residue',JSON.stringify(residue));}
 await browser.close();await db.end();
}
