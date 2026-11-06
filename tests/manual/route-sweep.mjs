// Visits every route in the registry, in every viewport, with two disposable local accounts, and removes them at the end.
// Navigation only: it clicks nothing, and the browser cannot reach other hosts.
// QA_PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs QA_CHROME_PATH=... node tests/manual/route-sweep.mjs [--only=/route]
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {sourceHash} from '../../scripts/lib/release-coverage.ts';
import {removeQaAccounts} from './qa-cleanup.mjs';
process.loadEnvFile('.env.local');
const origin='http://127.0.0.1:3210',out='docs/validation/evidence/08a-final-regression';mkdirSync(out+'/failures',{recursive:true});
const url=new URL(process.env.MIGRATOR_DATABASE_URL);if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Local database required.');
const db=new pg.Pool({connectionString:url.toString()});
const {chromium}=await import(process.env.QA_PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROME_PATH});
const sizes={'1920':[1920,855],'1440':[1440,900],'768':[768,1024],'390':[390,844],'320':[320,700],'390-dark':[390,844],zoom200:[960,428],'font-large':[320,700]};
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7);
const items=JSON.parse(readFileSync('docs/validation/08-release-matrix.json','utf8')).items.filter(i=>i.kind==='route');
const attemptedEmails=[];
// Nothing leaves this machine, whatever a page tries.
const guard=context=>context.route('**/*',r=>{const h=new URL(r.request().url()).hostname;return h==='127.0.0.1'||h==='localhost'?r.continue():r.abort();});
async function account(name){
 const email=`re-qa-08a-${name}-${Date.now()}@example.com`,password='Local-QA-08a-pass-7351!';
 attemptedEmails.push(email);
 let r;
 for(let attempt=0;attempt<4;attempt++){
  r=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({registration:{phone:'(21) 97323-1943',accepted:true,termsVersion:'homologacao-2026-10-26-v2',privacyVersion:'homologacao-2026-10-26-v2'},name:'[RE] QA '+name,email,password,callbackURL:origin+'/onboarding/workspace'})});
  if(r.status!==429||attempt===3)break;
  await new Promise(resolve=>setTimeout(resolve,75000));
 }
 if(!r.ok)throw Error('signup '+r.status+' '+(await r.text()).slice(0,200));
 await new Promise(w=>setTimeout(w,1500));
 const box=await (await fetch(`http://127.0.0.1:8125/api/v2/search?kind=to&query=${encodeURIComponent(email)}`)).json();let link;
 for(const m of box.items??[]){const t=m.Content.Body.replace(/=\r?\n/g,'').replace(/=([A-Fa-f0-9]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16)));link=(t.match(/https?:\/\/[^\s<>"]+/g)??[]).find(x=>x.includes('verify-email'))??link;}
 if(!link)throw Error('no verification link');
 const context=await browser.newContext({viewport:{width:1440,height:900}});await guard(context);
 const page=await context.newPage();await page.goto(link,{waitUntil:'load',timeout:120000});await page.getByText('Carregando sua conta').waitFor({state:'hidden',timeout:60000}).catch(()=>{});await page.waitForTimeout(1500);await page.getByPlaceholder('Sua empresa').fill('[RE] QA 08A '+name);await page.getByRole('button',{name:/Criar workspace/}).click();await page.waitForURL(u=>!u.pathname.includes('onboarding/workspace'),{timeout:120000});
 const ws=(await db.query('SELECT m."organizationId" AS ws,u.id FROM auth."user" u JOIN auth.member m ON m."userId"=u.id WHERE u.email=$1',[email])).rows[0];
 const lead=randomUUID(),list=randomUUID(),marker='RE-MARCADOR-'+name.toUpperCase();
 await db.query('INSERT INTO app.list VALUES($1,$2,$3)',[ws.ws,list,'[RE] Lista '+name]);
 // A full page of contacts: tables must hold at 320 px with data, not only empty.
 for(let i=0;i<30;i++){const id=i?randomUUID():lead;await db.query('INSERT INTO app.lead VALUES($1,$2,$3,$4)',[ws.ws,id,list,{id,listId:list,name:marker+(i?' '+i:''),site:'https://example.com/',source:'MANUAL',qualification:'pending',createdAt:new Date().toISOString()}]);}
 return {name,email,workspace:ws.ws,user:ws.id,lead,marker,context,page};
}
const inspect=()=>{
 const w=innerWidth,visible=e=>e.checkVisibility({checkVisibilityCSS:true,contentVisibilityAuto:true})&&e.getBoundingClientRect().width>0,describe=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\s+/).slice(0,2).join('.'):'')+' "'+(e.innerText||'').trim().slice(0,24)+'"';
 const scrollable=e=>{for(let p=e.parentElement;p;p=p.parentElement){const o=getComputedStyle(p).overflowX;if(o==='auto'||o==='scroll')return true;}return false;};
 const interactive='button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=switch],[role=checkbox],[role=menuitem],[role=combobox]';
 // Out of reach: past the edge with no scroller to bring it back. Page scrollWidth misses what fixed or hidden parents clip.
 const controls=[...document.querySelectorAll(interactive)].filter(visible);
 const offscreen=controls.filter(e=>{const b=e.getBoundingClientRect();return (b.right>w+1||b.left<-1)&&!scrollable(e)&&!e.closest('[inert]');}).slice(0,4).map(describe);
 const named=e=>{const label=e.getAttribute('aria-label')?.trim(),by=e.getAttribute('aria-labelledby');if(label||e.getAttribute('title')?.trim()||(e.innerText||'').trim()||e.querySelector('img[alt]:not([alt=""]),svg title'))return true;if(by&&by.split(/\s+/).some(id=>document.getElementById(id)?.textContent?.trim()))return true;if(['INPUT','SELECT','TEXTAREA'].includes(e.tagName))return !!e.labels?.length;return false;};
 const unnamed=controls.filter(e=>!named(e)).slice(0,5).map(describe);
 const text=document.body.innerText;
 return {overflow:document.documentElement.scrollWidth-w,offscreen,unnamed,path:location.pathname,theme:document.documentElement.dataset.theme??'n/a',fontSize:parseFloat(getComputedStyle(document.documentElement).fontSize),text,fallback:/Internal Server Error|NEXT_HTTP_ERROR_FALLBACK;500|Application error|Não foi possível carregar seu workspace/.test(text),busy:!!document.querySelector('[aria-busy="true"],.billing-loading')||/Carregando|Consultando/.test(text)};
};
async function visit(who,item,viewport){
 const route=item.id,[width,height]=sizes[viewport],page=who.page,errors=[],bad=[],console4=[],dark=viewport.endsWith('dark');
 await page.setViewportSize({width,height});
 if(page.url()==='about:blank')await page.goto(origin+'/login',{waitUntil:'load',timeout:180000});
 // The theme is the app's own setting; emulating the media query would change nothing here.
 await page.evaluate(t=>localStorage.setItem('cadence-ui',JSON.stringify({theme:t.theme,typographyVersion:2,font:t.font})),{theme:dark?'dark':'light',font:viewport==='font-large'?18:16});
 const onError=e=>errors.push(e.message.slice(0,200)),onConsole=m=>{if(m.type()==='error'&&!/Failed to load resource|net::ERR_/.test(m.text()))console4.push(m.text().slice(0,160));};
 const onResponse=r=>{const u=new URL(r.url());if(u.hostname!=='127.0.0.1')return;if(r.status()>=500)bad.push(r.status()+' '+u.pathname);else if(r.status()>=400&&u.pathname.startsWith('/api/')&&!(item.allow??[]).includes(r.status()))bad.push(r.status()+' '+u.pathname);};
 page.on('pageerror',onError);page.on('console',onConsole);page.on('response',onResponse);
 const target=route.replace(':seed',who.lead);let status=0,m=null,failure=null;
 try{
  const r=await page.goto(origin+target,{waitUntil:'load',timeout:180000});status=r?.status()??0;
  await page.waitForLoadState('networkidle',{timeout:6000}).catch(()=>{});
  for(let i=0;i<20;i++){m=await page.evaluate(inspect);if(!m.busy)break;await page.waitForTimeout(500);}
 }catch(e){failure=e.message.slice(0,200);}
 page.off('pageerror',onError);page.off('console',onConsole);page.off('response',onResponse);
 const expect=item.expectText?.replace('{marker}',who.marker),missing=expect&&m&&!m.text.includes(expect);
 const ok=!failure&&status<500&&!errors.length&&!console4.length&&!bad.length&&m&&!m.fallback&&!m.busy&&!missing&&m.overflow<=1&&!m.offscreen.length&&!m.unnamed.length;
 if(!ok)await page.screenshot({path:`${out}/failures/${route.replace(/[^a-z0-9]+/gi,'_')}-${viewport}.jpg`,type:'jpeg',quality:60}).catch(()=>{});
 const {text:_text,...facts}=m??{};
 return {route,viewport,account:who.name,status,ok:!!ok,path:facts.path,theme:facts.theme,fontSize:facts.fontSize,...(ok?{}:{failure,errors,console:console4,bad:[...new Set(bad)],missing:!!missing,...facts})};
}
try{
 const a=await account('a'),b=await account('b');
 // Account a: Pro pilot, so paid modules render beyond their gate. Account b: a trial started by the app's own function.
 const set=await db.query("UPDATE app.billing_account SET state='pilot',plan='pro',period_start=now(),period_end=now()+interval '7 days' WHERE workspace_id=$1",[a.workspace]);if(set.rowCount!==1)throw Error('pilot fixture');
 const c=await db.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.workspace_id',$1,true),set_config('app.user_id',$2,true)",[b.workspace,b.user]);await c.query('SELECT app.billing_start_trial($1)',[randomUUID()]);await c.query('COMMIT');}finally{c.release();}
 const anonContext=await browser.newContext();await guard(anonContext);const anon={name:'anon',page:await anonContext.newPage(),lead:a.lead,marker:a.marker};
 const results=[],hash=sourceHash();
 // A partial run must never replace the full report the audit reads.
 const save=(extra={})=>only||writeFileSync(out+'/route-sweep.json',JSON.stringify({date:new Date().toISOString(),sourceHash:hash,note:'Só navegação; hosts externos bloqueados; contas descartáveis removidas ao fim.',results,...extra},null,1)+'\n');
 for(const item of items){
  if(only&&item.id!==only)continue;
  for(const viewport of Object.keys(sizes)){const r=await visit(item.public?anon:a,item,viewport);results.push(r);if(!r.ok)console.log('FAIL',item.id,viewport,JSON.stringify({s:r.status,p:r.path,f:r.failure,e:r.errors,c:r.console,b:r.bad,m:r.missing,o:r.overflow,x:r.offscreen,u:r.unnamed,busy:r.busy,fb:r.fallback}).slice(0,420));else if(r.path!==(item.expectPath??item.id)&&!item.expectPath?.startsWith('^'))console.log('PATH',item.id,viewport,r.path);}
  console.log('done',item.id);save();
 }
 // Two accounts side by side: each sees its own data, by list and by id, and only its own.
 const isolation=[];
 for(const [me,other] of [[a,b],[b,a]]){
  const read=async route=>{await me.page.setViewportSize({width:1440,height:900});await me.page.goto(origin+route,{waitUntil:'load',timeout:180000});await me.page.waitForLoadState('networkidle',{timeout:6000}).catch(()=>{});await me.page.waitForTimeout(1500);return me.page.evaluate(()=>document.body.innerText);};
  const list=await read('/contacts'),own=await read('/leads/'+me.lead),cross=await read('/leads/'+other.lead);
  isolation.push({account:me.name,seesOwn:list.includes(me.marker),seesOwnById:own.includes(me.marker),seesOtherInList:list.includes(other.marker),seesOtherById:cross.includes(other.marker)});
 }
 await b.page.goto(origin+'/dashboard',{waitUntil:'load',timeout:180000});await b.page.waitForTimeout(2500);const trialCta=await b.page.locator('.sidebar-bottom .btn.trial').innerText();
 if(!only&&sourceHash()!==hash)throw Error('The code changed during the sweep; its results measure nothing.');
 save({isolation,trialCta});console.log(JSON.stringify(isolation),'trialCta:',trialCta);
 console.log(`${results.filter(r=>r.ok).length}/${results.length} ok`);
 if(results.some(r=>!r.ok)||!results.length||isolation.some(row=>!row.seesOwn||!row.seesOwnById||row.seesOtherInList||row.seesOtherById))process.exitCode=1;
}finally{
 await browser.close();
 try{
  const residue=await removeQaAccounts(db,{users:[],workspaces:[],emails:attemptedEmails});
  console.log('residue',residue);
  if(residue!==0)process.exitCode=1;
 }finally{await db.end();}
}
