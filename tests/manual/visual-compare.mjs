// Captures the local app at the viewport of the stored reference captures. The reference itself is never accessed.
// QA_PLAYWRIGHT_MODULE=... QA_CHROME_PATH=... node tests/manual/visual-compare.mjs <output dir>
import {mkdirSync} from 'node:fs';
import pg from 'pg';
import {removeQaAccounts} from './qa-cleanup.mjs';
process.loadEnvFile('.env.local');
const origin='http://127.0.0.1:3210',out=process.argv[2];mkdirSync(out,{recursive:true});
if(!['127.0.0.1','localhost'].includes(new URL(process.env.MIGRATOR_DATABASE_URL).hostname))throw Error('Local database required.');
const db=new pg.Pool({connectionString:process.env.MIGRATOR_DATABASE_URL});
const {chromium}=await import(process.env.QA_PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROME_PATH});
const routes={dashboard:'/dashboard',contacts:'/contacts','leads-generator':'/leads/generator','leads-qualifier':'/leads/qualifier','leads-enrich':'/leads/enrich','leads-import':'/leads/import',cadences:'/cadences','cadences-new':'/cadences/new','cadences-pipeline':'/cadences/pipeline',automations:'/automations','automations-new':'/automations/new',executions:'/executions',inbox:'/inbox','messages-whatsapp':'/messages/whatsapp',reports:'/reports','reports-funnel':'/reports/funnel',sdr:'/sdr','first-steps':'/first-steps','linkedin-dashboard':'/linkedin/dashboard','linkedin-campaigns':'/linkedin/campaigns','settings-account':'/settings/account','settings-context':'/settings/context','settings-seats':'/settings/seats','settings-webhooks':'/settings/webhooks','settings-apps':'/settings/apps','settings-email':'/settings/email','settings-whatsapp':'/settings/whatsapp','settings-dados':'/settings/dados','settings-plan':'/settings/plan'};
const email=`re-qa-08a-visual-${Date.now()}@example.com`,password='Local-QA-08a-pass-7351!';
try{
 let r;for(let i=0;i<8;i++){r=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({registration:{phone:'(21) 97323-1943',accepted:true,termsVersion:'homologacao-2026-10-26-v2',privacyVersion:'homologacao-2026-10-26-v2'},name:'[RE] QA visual',email,password,callbackURL:origin+'/onboarding/workspace'})});if(r.status!==429)break;await new Promise(w=>setTimeout(w,70000));}
  if(!r.ok)throw Error('signup '+r.status);
 await new Promise(w=>setTimeout(w,1500));
 const box=await (await fetch(`http://127.0.0.1:8125/api/v2/search?kind=to&query=${encodeURIComponent(email)}`)).json();let link;
 for(const m of box.items??[]){const t=m.Content.Body.replace(/=\r?\n/g,'').replace(/=([A-Fa-f0-9]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16)));link=(t.match(/https?:\/\/[^\s<>"]+/g)??[]).find(x=>x.includes('verify-email'))??link;}
 const context=await browser.newContext({viewport:{width:1920,height:855}});await context.route('**/*',x=>{const h=new URL(x.request().url()).hostname;return h==='127.0.0.1'||h==='localhost'?x.continue():x.abort();});
 const page=await context.newPage();await page.goto(link,{waitUntil:'load',timeout:120000});await page.getByText('Carregando sua conta').waitFor({state:'hidden',timeout:60000}).catch(()=>{});await page.waitForTimeout(1500);await page.getByPlaceholder('Sua empresa').fill('[RE] QA Visual');await page.getByRole('button',{name:/Criar workspace/}).click();await page.waitForURL(u=>!u.pathname.includes('onboarding/workspace'),{timeout:120000});
 for(const [name,route] of Object.entries(routes))for(const [kind,w,h] of [['desktop',1920,855],['mobile',390,844]]){await page.setViewportSize({width:w,height:h});await page.goto(origin+route,{waitUntil:'load',timeout:180000});await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{});await page.waitForTimeout(600);await page.screenshot({path:`${out}/local-${kind}-${name}.png`,fullPage:true});}
 console.log('captured',Object.keys(routes).length);
}finally{await browser.close();const rows=(await db.query('SELECT m."organizationId" AS ws,u.id FROM auth."user" u LEFT JOIN auth.member m ON m."userId"=u.id WHERE u.email=$1',[email])).rows;console.log('residue',await removeQaAccounts(db,{users:rows.map(x=>x.id),workspaces:rows.map(x=>x.ws).filter(Boolean)}));await db.end();}
