// Clicks the main journeys with disposable local accounts, and removes them at the end.
// The browser cannot reach other hosts; the accounts have no active channels; nothing is sent, no paid provider runs, no Stripe write is confirmed.
// QA_PLAYWRIGHT_MODULE=file:///.../playwright/index.mjs QA_CHROME_PATH=... node tests/manual/full-journeys.mjs [--only=journey]
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {sourceHash} from '../../scripts/lib/release-coverage.ts';
import {removeQaAccounts} from './qa-cleanup.mjs';
import {seedExecutionDiary} from './execution-diary-fixture.mjs';
import {defaultCadenceSettings} from '../../src/demo/seed.ts';
process.loadEnvFile('.env.local');
const origin='http://127.0.0.1:3210',out='docs/validation/evidence/08a-final-regression';mkdirSync(out+'/journey-failures',{recursive:true});
const url=new URL(process.env.MIGRATOR_DATABASE_URL);if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Local database required.');
const db=new pg.Pool({connectionString:url.toString()});
const {chromium}=await import(process.env.QA_PLAYWRIGHT_MODULE);
const browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROME_PATH});
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7);
const created=[],attemptedEmails=new Set(),open=[],hash=sourceHash();let issues=[];
/** Waits for a real effect; a fixed sleep would only measure how slow the dev server is. */
const until=async(fn,message,ms=30000)=>{const end=Date.now()+ms;let last;while(Date.now()<end){last=await fn();if(last)return last;await new Promise(w=>setTimeout(w,300));}assert.fail(message+' (last: '+last+')');};
async function newContext(viewport={width:1440,height:900}){const context=await browser.newContext({viewport});open.push(context);await context.route('**/*',r=>{const h=new URL(r.request().url()).hostname;return h==='127.0.0.1'||h==='localhost'?r.continue():r.abort();});const page=await context.newPage();page.on('pageerror',e=>issues.push('pageerror '+e.message.slice(0,120)));page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).pathname.startsWith('/api/'))issues.push(r.status()+' '+r.request().method()+' '+new URL(r.url()).pathname);});return {context,page};}
const mailLink=async(email,kind='verify-email')=>{for(let i=0;i<20;i++){const box=await (await fetch(`http://127.0.0.1:8125/api/v2/search?kind=to&query=${encodeURIComponent(email)}`)).json();for(const m of box.items??[]){const t=m.Content.Body.replace(/=\r?\n/g,'').replace(/=([A-Fa-f0-9]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16)));const l=(t.match(/https?:\/\/[^\s<>"]+/g)??[]).find(x=>x.includes(kind));if(l)return l;}await new Promise(w=>setTimeout(w,500));}throw Error('no mail link');};
/** A fast account: API signup and the real workspace form. The signup journey does this by hand instead. */
async function account(name,{plan=null,paid=false}={}){
 const email=`re-qa-08a-${name}-${Date.now()}@example.com`,password='Local-QA-08a-pass-7351!';
 attemptedEmails.add(email);
 // The app limits signups; this waits for the window instead of working around it.
 let r;for(let i=0;i<8;i++){r=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({registration:{phone:'(21) 97323-1943',accepted:true,termsVersion:'homologacao-2026-10-26-v2',privacyVersion:'homologacao-2026-10-26-v2'},name:'[RE] QA '+name,email,password,callbackURL:origin+'/onboarding/workspace'})});if(r.status!==429)break;await new Promise(w=>setTimeout(w,70000));}
 if(!r.ok)throw Error('signup '+r.status);
 const {context,page}=await newContext();await page.goto(await mailLink(email),{waitUntil:'load',timeout:120000});await workspaceForm(page,'[RE] QA 08A '+name);
 const row=(await db.query('SELECT m."organizationId" AS ws,u.id FROM auth."user" u JOIN auth.member m ON m."userId"=u.id WHERE u.email=$1',[email])).rows[0];created.push(row);
 if(plan==='trial'){const c=await db.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.workspace_id',$1,true),set_config('app.user_id',$2,true)",[row.ws,row.id]);await c.query('SELECT app.billing_start_trial($1)',[randomUUID()]);await c.query('COMMIT');}finally{c.release();}}
 else if(plan){await db.query("UPDATE app.billing_account SET state=$3,plan=$2,period_start=now(),period_end=now()+interval '7 days' WHERE workspace_id=$1",[row.ws,plan,paid?'active':'pilot']);for(const unit of ['imports','extractions'])await db.query("INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref,expires_at) VALUES($1,$2,$3,1000,$4,$2,now()+interval '7 days')",[row.ws,randomUUID(),unit,paid?'plan':'pilot']);}
 return {email,password,workspace:row.ws,user:row.id,context,page};
}
async function workspaceForm(page,name){await page.getByText('Carregando sua conta').waitFor({state:'hidden',timeout:60000}).catch(()=>{});await page.waitForTimeout(1500);await page.getByPlaceholder('Sua empresa').fill(name);await page.getByRole('button',{name:/Criar workspace/}).click();await page.waitForURL(u=>!u.pathname.includes('onboarding/workspace'),{timeout:120000});}
const go=async(page,route)=>{await page.goto(origin+route,{waitUntil:'load',timeout:180000});await page.waitForLoadState('networkidle',{timeout:6000}).catch(()=>{});};
const seen=(page,text)=>page.getByText(text).first().waitFor({state:'visible',timeout:20000});
const planTab=async page=>{await go(page,'/settings/plan');await page.getByRole('tab',{name:'Planos e pacotes'}).click();};
const openLead=async page=>{await page.getByRole('button',{name:'Adicionar'}).first().click();await page.locator('.dropdown button').nth(1).click();await page.getByRole('dialog').first().waitFor();};
const lead=(ws,list,fields={})=>{const id=randomUUID();return db.query('INSERT INTO app.lead VALUES($1,$2,$3,$4)',[ws,id,list,{id,listId:list,name:'[RE] Lead',site:'https://example.com/',source:'MANUAL',qualification:'pending',createdAt:new Date().toISOString(),...fields}]).then(()=>id);};
const journeys={
 async signup(step){
  const email=`re-qa-08a-signup-${Date.now()}@example.com`,password='Local-QA-08a-pass-7351!',{page}=await newContext();
  attemptedEmails.add(email);
  await step('preenche o cadastro',async()=>{await go(page,'/register');await page.getByRole('button',{name:'Continuar'}).click();await page.getByLabel('Nome').fill('[RE] QA Cadastro');await page.getByLabel('E-mail').fill(email);await page.getByLabel('Telefone').fill('(21) 97323-1943');await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByLabel('Confirmar senha').fill(password);await page.getByRole('checkbox').first().check();await page.getByRole('button',{name:'Criar conta e verificar e-mail'}).click();await until(async()=>(await db.query('SELECT count(*)::int n FROM auth."user" WHERE email=$1',[email])).rows[0].n===1,'user created');});
  await step('verifica o e-mail e cria o workspace',async()=>{await page.goto(await mailLink(email),{waitUntil:'load',timeout:120000});await workspaceForm(page,'[RE] QA Cadastro');const row=(await db.query('SELECT m."organizationId" AS ws,u.id FROM auth."user" u JOIN auth.member m ON m."userId"=u.id WHERE u.email=$1',[email])).rows[0];assert.ok(row);created.push(row);});
  await step('ativa o teste de 7 dias',async()=>{await go(page,'/settings/plan');await page.getByRole('button',{name:'Começar o teste grátis'}).last().click();await page.getByRole('dialog').getByRole('button',{name:/Ativar/}).click();await page.getByRole('dialog').waitFor({state:'detached'});await until(async()=>(await db.query('SELECT state FROM app.billing_account WHERE workspace_id=$1',[created.at(-1).ws])).rows[0].state==='trial','trial started');assert.equal((await db.query('SELECT state FROM app.billing_account WHERE workspace_id=$1',[created.at(-1).ws])).rows[0].state,'trial');});
  await step('o menu deixa de oferecer o teste',async()=>{await go(page,'/dashboard');assert.equal(await page.locator('.sidebar-bottom .btn.trial').innerText(),'Gerenciar meu plano');});
  await step('revisa a assinatura anual, sem confirmar',async()=>{await planTab(page);await page.getByRole('button',{name:/Anual/}).click();await page.locator('.billing-comparison-plan').first().getByRole('button').click();const review=page.getByRole('dialog');await review.getByText('Revisar alteração de cobrança').waitFor();await review.getByText('R$ 3.811,20').first().waitFor();await review.getByRole('button',{name:'Voltar'}).click();assert.equal((await db.query('SELECT count(*)::int n FROM app.billing_operation WHERE workspace_id=$1',[created.at(-1).ws])).rows[0].n,0,'nothing confirmed');});
 },
 async pack(step){
  const a=await account('pack',{plan:'essential',paid:true}),{page}=a;
  await step('plano mostra limites separados de captação e qualificação',async()=>{
   await go(page,'/settings/plan');
   await seen(page,'Qualificações de hoje, incluindo reservas');
   const usage=await page.locator('.billing-usage-footnote').allTextContents();
   assert.ok(usage.some(text=>text.includes('Franquia 0 / 250')&&text.includes('Adicionais 0 / 250')));
   assert.ok(usage.some(text=>text.includes('Qualificações de hoje')&&text.includes('0 / 250')));
   const positions=await page.locator('.billing-usage-footnote').evaluateAll(items=>items.map(item=>item.getBoundingClientRect().left));
   assert.ok(positions.every(x=>Math.abs(x-positions[0])<1),'medidores diários alinhados com o resumo mensal');
   mkdirSync('output/playwright/usage-limits',{recursive:true});
   await page.screenshot({path:'output/playwright/usage-limits/essential-plan.png',fullPage:true});
   await page.setViewportSize({width:390,height:844});
   try{
    await seen(page,'Qualificações de hoje, incluindo reservas');
    await until(()=>page.evaluate(()=>innerWidth===390&&document.documentElement.scrollWidth<=innerWidth+1),'layout do plano cabe em 390 px',5000);
    await page.screenshot({path:'output/playwright/usage-limits/essential-plan-mobile.png',fullPage:true});
   }finally{await page.setViewportSize({width:1440,height:900});}
  });
  await step('jornada herda créditos e permite revisar a escolha antes de buscar',async()=>{
   await go(page,'/leads/generator');
   await page.getByRole('combobox',{name:'Saldo para extrações'}).click();
   await page.getByRole('option',{name:'Créditos adicionais',exact:true}).click();
   await page.getByRole('button',{name:'Prospecção completa',exact:true}).click();
   const dialog=page.getByRole('dialog');
   assert.equal(await dialog.getByRole('combobox',{name:'Saldo para extrações'}).innerText(),'Créditos adicionais');
   await dialog.getByRole('combobox',{name:'Saldo para extrações'}).click();
   await page.getByRole('option',{name:'Franquia do plano',exact:true}).click();
   assert.equal(await dialog.getByRole('combobox',{name:'Saldo para extrações'}).innerText(),'Franquia do plano');
   await dialog.getByLabel('Quem você quer alcançar').fill('[RE] Esquadrias');
   await dialog.getByLabel('CNAE principal').fill('2512800');
   await dialog.getByLabel('Município').fill('Curitiba');
   await dialog.getByRole('combobox',{name:'Estado (UF)'}).click();
   await page.getByRole('option',{name:'PR · Paraná',exact:true}).click();
   await dialog.getByRole('button',{name:'Revisar prospecção',exact:true}).click();
   await dialog.getByText(/Base CNPJ ativa · CNAE 2512800/).waitFor();
   await dialog.getByText(/Curitiba, PR/).waitFor();
   const evidence='output/playwright/registry-first';
   mkdirSync(evidence,{recursive:true});
   await page.setViewportSize({width:1920,height:855});
   await page.screenshot({path:evidence+'/review-1920.png',animations:'disabled'});
   await page.setViewportSize({width:390,height:844});
   try{
    assert.ok(await dialog.getByText(/Base CNPJ ativa/).isVisible());
    assert.ok(await dialog.evaluate(el=>{
     const box=el.getBoundingClientRect();
     return box.left>=0&&box.right<=innerWidth+1&&el.scrollWidth<=el.clientWidth+1;
    }),'o diálogo cabe no viewport de 390 px');
    await page.screenshot({path:evidence+'/review-390.png',animations:'disabled'});
   }finally{await page.setViewportSize({width:1440,height:900});}
   await dialog.getByRole('button',{name:'Voltar',exact:true}).click();
   await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
   assert.equal((await db.query('SELECT count(*)::int n FROM app.prospecting_job WHERE workspace_id=$1',[a.workspace])).rows[0].n,0);
  });
  await step('revisa um pacote com o preço do servidor, sem confirmar',async()=>{await planTab(page);await page.locator('.billing-addon-card').first().getByRole('button').click();const review=page.getByRole('dialog');await review.getByText('Revisar alteração de cobrança').waitFor();await review.getByText('R$ 97,00').first().waitFor();await review.getByRole('button',{name:'Voltar'}).click();await review.waitFor({state:'detached'});});
  await step('cupom inexistente é recusado na tela e o rascunho fica',async()=>{await page.getByLabel('Tem um cupom?').fill('naoexiste');await page.locator('.billing-addon-card').first().getByRole('button').click();await seen(page,'Cupom inválido, vencido ou já utilizado.');assert.equal(await page.getByLabel('Tem um cupom?').inputValue(),'naoexiste');});
  await step('nada foi cobrado nem criado',async()=>{assert.equal((await db.query('SELECT count(*)::int n FROM app.billing_operation WHERE workspace_id=$1',[a.workspace])).rows[0].n,0);});
 },
 async data(step){
  const a=await account('data',{plan:'essential'}),{page}=a,list=randomUUID();await db.query('INSERT INTO app.list VALUES($1,$2,$3)',[a.workspace,list,'[RE] Lista dados']);
  await lead(a.workspace,list,{name:'[RE] Original',email:'dup@example.com'});await lead(a.workspace,list,{name:'[RE] Repetido',email:'dup@example.com'});
  const count=async()=>(await db.query('SELECT count(*)::int n FROM app.lead WHERE workspace_id=$1',[a.workspace])).rows[0].n;
  await step('encontra e funde os duplicados',async()=>{await go(page,'/settings/dados');await page.getByRole('button',{name:'Procurar duplicados'}).click();await seen(page,'dup@example.com');await page.getByRole('button',{name:/Fundir|Mesclar|Unificar/}).first().click();await page.getByRole('dialog').getByRole('button',{name:/Confirmar|Fundir|Mesclar|Unificar/}).last().click();await until(async()=>await count()===1,'contacts merged');await page.getByRole('dialog').waitFor({state:'detached'});});
  await step('desfaz a fusão',async()=>{await page.getByRole('button',{name:/Desfazer/}).first().click();await page.getByRole('dialog').getByRole('button',{name:'Desfazer'}).click();await until(async()=>await count()===2,'contact restored');});
  await step('exporta os contatos',async()=>{await go(page,'/contacts');const download=page.waitForEvent('download',{timeout:20000});await page.getByRole('button',{name:'Mais ações'}).click();await page.getByText('Exportar contatos filtrados').click();const file=await download;assert.match(file.suggestedFilename(),/\.csv$/i);const text=readFileSync(await file.path(),'utf8');assert.match(text,/\[RE\] Original/,'export has the contact');});
  await step('apagar texto antigo exige confirmação digitada',async()=>{await go(page,'/settings/privacy');await page.getByRole('switch').first().click();await page.getByRole('button',{name:/Salvar/}).click();await seen(page,'Digite APAGAR para confirmar');assert.equal(await page.getByRole('button',{name:/Ligar|Confirmar|Apagar/}).last().isDisabled(),true);await page.getByRole('button',{name:'Cancelar'}).click();});
 },
 async api(step){
  const a=await account('api',{plan:'pro'}),{page}=a;let token='';
  const call=()=>fetch(origin+'/api/v1/leads',{headers:{authorization:'Bearer '+token}});
  await step('cria uma chave e a API responde',async()=>{await go(page,'/settings/webhooks');await page.getByRole('button',{name:'Nova chave'}).click();await page.getByRole('dialog').getByRole('textbox').first().fill('[RE] Chave');await page.getByRole('dialog').getByRole('button',{name:/Criar|Gerar/}).click();await page.waitForTimeout(1500);token=(await page.locator('.webhook-secret').innerText()).match(/[A-Za-z0-9_-]{20,}/)[0];assert.equal((await call()).status,200);});
  await step('o escopo limita a chave: só leitura de leads não lê eventos',async()=>{const r=await fetch(origin+'/api/v1/events',{headers:{authorization:'Bearer '+token}});assert.equal(r.status,403);});
  await step('chave falsa é recusada',async()=>{assert.equal((await fetch(origin+'/api/v1/leads',{headers:{authorization:'Bearer cadence_nao_existe'}})).status,401);});
  await step('revogar corta o acesso',async()=>{await go(page,'/settings/webhooks');await page.getByRole('button',{name:/Revogar/}).first().click();await page.getByRole('dialog').getByRole('button',{name:'Revogar'}).click();await until(async()=>(await call()).status===401,'key stops working');});
 },
 async popups(step){
  const a=await account('popups',{plan:'essential'}),{page}=a;await go(page,'/dashboard');
  const closes=async(open,visible)=>{await open();await visible();const before=await page.evaluate(()=>document.body.scrollWidth-innerWidth);assert.ok(before<=1);await page.keyboard.press('Escape');await page.waitForTimeout(300);};
  await step('busca abre com Ctrl+K e fecha com Escape',async()=>{await closes(()=>page.keyboard.press('Control+k'),()=>page.getByRole('dialog').first().waitFor());assert.equal(await page.getByRole('dialog').count(),0);});
  await step('Central de Ajuda abre e fecha',async()=>{await go(page,'/aprender');await closes(()=>page.getByRole('button',{name:'Central de Ajuda',exact:true}).click(),()=>page.getByRole('dialog').first().waitFor());assert.equal(await page.getByRole('dialog').count(),0);await go(page,'/dashboard');});
  await step('Como funciona abre e fecha',async()=>{await closes(()=>page.getByRole('button',{name:'Como funciona'}).first().click(),()=>page.getByRole('dialog').first().waitFor());assert.equal(await page.getByRole('dialog').count(),0);});
  await step('notificações abrem',async()=>{const bell=page.getByRole('button',{name:'Notificações'});await bell.click();const panel=page.getByRole('dialog').first();await panel.waitFor();await page.keyboard.press('Escape');await panel.waitFor({state:'detached'});});
  await step('novo lead abre e fecha',async()=>{await go(page,'/contacts');await openLead(page);await page.keyboard.press('Escape');await page.waitForTimeout(300);assert.equal(await page.getByRole('dialog').count(),0);});
  await step('a 320 px o menu abre e fecha',async()=>{await page.setViewportSize({width:320,height:700});await go(page,'/dashboard');const open=page.getByRole('button',{name:'Abrir menu'});await open.click();await until(async()=>await open.getAttribute('aria-expanded')==='true','menu open');const link=page.getByRole('link',{name:'Relatórios'});await until(async()=>{const b=await link.boundingBox();return b&&b.x>=0&&b.x+b.width<=320;},'link inside the screen');await page.keyboard.press('Escape');await until(async()=>await open.getAttribute('aria-expanded')==='false','menu closed');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,true);});
 },
 async keyboard(step){
  const a=await account('keyboard',{plan:'essential'}),{page}=a;await go(page,'/contacts');
  await step('o foco fica preso no diálogo e volta ao botão',async()=>{const open=page.getByRole('button',{name:'Adicionar'}).first();await open.focus();await page.keyboard.press('Enter');await page.locator('.dropdown button').nth(1).focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog').first();await dialog.waitFor();for(let i=0;i<30;i++){await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(d=>d.contains(document.activeElement)||document.activeElement===document.body),'focus reached the page behind the dialog');}await page.keyboard.press('Escape');await page.waitForTimeout(300);assert.ok(await open.evaluate(e=>e===document.activeElement),'focus did not return');});
  await step('todo diálogo devolve o foco a quem abriu',async()=>{await go(page,'/aprender');const help=page.getByRole('button',{name:'Central de Ajuda',exact:true});await help.focus();await page.keyboard.press('Enter');await page.getByRole('dialog').first().waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});assert.ok(await help.evaluate(e=>e===document.activeElement),'focus lost');});
  await step('Tab anda sempre com foco visível',async()=>{await go(page,'/dashboard');for(let i=0;i<15;i++){await page.keyboard.press('Tab');const f=await page.evaluate(()=>{const e=document.activeElement;if(!e||e===document.body)return null;const look=()=>{const s=getComputedStyle(e);return [s.outlineStyle,s.outlineWidth,s.boxShadow,s.borderColor].join('|');},on=look();e.blur();const off=look();e.focus();return {changes:on!==off,tag:e.tagName+'.'+e.className};});assert.ok(f,'lost focus');assert.ok(f.changes,'focus changes nothing on '+f.tag);}});
 },
 async network(step){
  const a=await account('network',{plan:'essential'}),{page}=a;
  const form=async()=>{await go(page,'/contacts');await openLead(page);await page.getByLabel(/Nome da empresa/).fill('[RE] Rascunho');await page.getByLabel(/Nome da nova lista/).fill('[RE] Lista rascunho').catch(()=>{});};
  const value=()=>page.getByLabel(/Nome da empresa/).inputValue(),submit=()=>page.getByRole('dialog').getByRole('button',{name:/Salvar|Adicionar|Criar/}).last().click();
  await step('503 mostra o erro e não perde o rascunho',async()=>{await form();await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.fulfill({status:503,contentType:'application/json',body:'{"error":"indisponível"}'}));await submit();await page.waitForTimeout(1500);assert.equal(await value(),'[RE] Rascunho');const notice=page.locator('.toast');await notice.waitFor({timeout:10000});assert.ok((await notice.innerText()).trim().length>3);assert.doesNotMatch(await notice.innerText(),/salvo/i);assert.ok(await notice.evaluate(e=>e.matches(':popover-open')),'the error would be hidden behind the dialog');await page.unroute('**/api/**');});
  await step('offline também não perde, e a nova tentativa salva',async()=>{await a.context.setOffline(true);try{await submit();await page.waitForTimeout(1500);assert.equal(await value(),'[RE] Rascunho');}finally{await a.context.setOffline(false);}await submit();await until(async()=>(await db.query("SELECT count(*)::int n FROM app.lead WHERE workspace_id=$1 AND payload->>'name'='[RE] Rascunho'",[a.workspace])).rows[0].n===1,'saved on retry');});
  await step('resposta lenta não permite salvar duas vezes',async()=>{await form();await page.getByLabel(/Nome da empresa/).fill('[RE] Lento');await page.route('**/api/**',async r=>{if(r.request().method()!=='GET')await new Promise(w=>setTimeout(w,2500));await r.continue().catch(()=>{});});const button=page.getByRole('dialog').getByRole('button',{name:/Salvar|Adicionar|Criar/}).last();await button.click();await button.click({timeout:800}).catch(()=>{});await page.waitForTimeout(4000);await page.unroute('**/api/**');const n=await until(async()=>(await db.query("SELECT count(*)::int n FROM app.lead WHERE workspace_id=$1 AND payload->>'name'='[RE] Lento'",[a.workspace])).rows[0].n,'saved');assert.equal(n,1);});
 },
 async roles(step){
  const a=await account('roles',{plan:'pro',paid:true}),operator=await account('operador');
  await db.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),a.workspace,operator.user,'operator']);
  const {page}=operator;
  await step('entra no workspace do dono',async()=>{const r=await page.request.post(origin+'/api/identity',{headers:{origin,'content-type':'application/json'},data:{type:'switch',workspaceId:a.workspace}});assert.equal(r.status(),200);});
  await step('a tela de plano não oferece gestão ao operador',async()=>{await planTab(page);await until(async()=>await page.locator('.billing-addon-card').first().getByRole('button').isDisabled(),'buy button disabled');await seen(page,'Somente proprietário ou administrador pode contratar.');});
  await step('a API de cobrança recusa o operador',async()=>{const r=await page.request.post(origin+'/api/billing/prepare',{headers:{origin,'content-type':'application/json','x-cadence-workspace':a.workspace},data:{kind:'cancel'}});assert.equal(r.status(),403);});
  await step('dono pode preparar a mesma ação',async()=>{const r=await a.page.request.post(origin+'/api/billing/prepare',{headers:{origin,'content-type':'application/json','x-cadence-workspace':a.workspace},data:{kind:'checkout',sku:'extractions-2000'}});assert.equal(r.status(),200);});
 },
 async 'cadence-editor'(step){
  const a=await account('editor',{plan:'pro'}),{page}=a,list=randomUUID(),id=randomUUID();await db.query('INSERT INTO app.list VALUES($1,$2,$3)',[a.workspace,list,'[RE] Lista editor']);
  // A draft never runs, so nothing is sent.
  await db.query('INSERT INTO app.cadence(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[a.workspace,id,list,{id,name:'[RE] Cadência existente',listId:list,status:'draft',createdAt:new Date().toISOString(),settings:defaultCadenceSettings(),steps:[{id:'s1',channel:'WHATSAPP',delayDays:1,body:'[RE] Mensagem do passo',stopOnReply:true}]}]);
  await step('abre a cadência existente, sem erro',async()=>{await go(page,'/cadences/'+id);await seen(page,'[RE] Cadência existente');await page.getByText('[RE] Mensagem do passo').first().waitFor();assert.equal(await page.getByText('Não foi possível carregar seu workspace').count(),0);});
  await step('o editor segura 320 px',async()=>{
   await page.setViewportSize({width:320,height:700});
   await go(page,'/cadences/'+id);
   const name=page.getByRole('textbox',{name:'Nome da cadência',exact:true});
   await name.waitFor({timeout:20000});
   assert.equal(await name.inputValue(),'[RE] Cadência existente');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);
   await page.setViewportSize({width:1440,height:900});
  });
  await step('a lista mostra a cadência como rascunho',async()=>{await go(page,'/cadences');await seen(page,'[RE] Cadência existente');});
  await step('a revisão da sequência fecha e devolve o foco',async()=>{
   await go(page,'/cadences/'+id);
   const open=page.getByRole('button',{name:'Otimizar',exact:true});
   await open.click({timeout:7000});
   const dialog=page.getByRole('dialog',{name:'Revisão da sequência'});
   await dialog.waitFor({timeout:7000});
   await page.keyboard.press('Escape');
   await dialog.waitFor({state:'detached',timeout:7000});
   assert.equal(await open.evaluate(e=>e===document.activeElement),true);
  });
  await step('503 ao salvar a cadência preserva o rascunho e o registro anterior',async()=>{
   const endpoint='**/api/workspace/commands';
   const fail=route=>route.request().method()==='POST'
    ?route.fulfill({status:503,json:{message:'[RE] Não foi possível salvar a cadência.'}})
    :route.fallback();
   await page.route(endpoint,fail);
   try{
    const name=page.getByRole('textbox',{name:'Nome da cadência',exact:true});
    await name.fill('[RE] Cadência alterada');
    await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
    await seen(page,'[RE] Não foi possível salvar a cadência.');
    assert.equal(await name.inputValue(),'[RE] Cadência alterada');
    await page.getByText('Alterações não salvas',{exact:true}).waitFor({timeout:7000});
    const {rows}=await db.query("SELECT payload->>'name' AS name FROM app.cadence WHERE workspace_id=$1 AND id=$2",[a.workspace,id]);
    assert.equal(rows[0].name,'[RE] Cadência existente');
   }finally{await page.unroute(endpoint,fail);}
  });
 },
 async 'execution-detail'(step){
  const a=await account('execucao',{plan:'pro'}),{page}=a,list=randomUUID(),id=randomUUID(),leadId=await (async()=>{await db.query('INSERT INTO app.list VALUES($1,$2,$3)',[a.workspace,list,'[RE] Lista execução']);return lead(a.workspace,list);})();
  // Already completed: the running workers must have nothing to pick up, so no provider is called.
  await db.query('INSERT INTO app.prospecting_job(workspace_id,id,actor_id,list_id,request_id,body_hash,kind,source,state,input,profile_version,checkpoint,counts) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[a.workspace,id,a.user,list,randomUUID(),'fixture','generation','MAPS','completed',{kind:'generation',source:'MAPS',destination:{mode:'existing',listId:list},filters:{term:'[RE] fixture',location:'QA'},limit:2,dedupScope:'workspace'},'fixture',{fixture:true,context:null},{found:1,inserted:1,duplicates:0,rejected:0,pending:0}]);assert.ok(leadId);
  await step('abre o detalhe de uma execução concluída',async()=>{await go(page,'/executions/'+id);await seen(page,'Busca de empresas');await seen(page,'1 inseridos');await seen(page,'Concluída');assert.equal(await page.getByText('Não foi possível carregar seu workspace').count(),0);});
  await step('o histórico de jobs mostra o resultado',async()=>{await go(page,'/executions?view=jobs');await seen(page,'Busca de empresas · MAPS');await seen(page,'1 novos');});
 },
 async 'prospect-local'(step){
  const a=await account('prospeccao',{plan:'essential'}),{page}=a,count=async()=>(await db.query('SELECT count(*)::int n FROM app.lead WHERE workspace_id=$1',[a.workspace])).rows[0].n;
  await step('adiciona um contato pelo formulário',async()=>{await go(page,'/contacts');await openLead(page);await page.getByLabel(/Nome da empresa/).fill('[RE] Empresa manual');await page.getByLabel(/Nome da nova lista/).fill('[RE] Lista manual');await page.getByRole('dialog').getByRole('button',{name:'Salvar contato'}).click();await until(async()=>await count()===1,'lead saved');await page.getByRole('dialog').waitFor({state:'detached'});await seen(page,'[RE] Empresa manual');});
  await step('importa colando linhas e revisa antes de salvar',async()=>{await go(page,'/leads/import');await page.getByRole('button',{name:'Digitar / colar'}).click();await page.locator('textarea').first().fill('[RE] Colada Um, um@example.com\n[RE] Colada Dois, dois@example.com');await page.locator('.import-manual-destination input[type=text],.import-manual-destination input:not([type])').first().fill('[RE] Lista colada');await page.getByRole('button',{name:'Visualizar Preview'}).click();await page.getByRole('button',{name:/^Importar/}).last().click();await until(async()=>await count()===3,'two imported');});
  await step('cria uma cadência do zero, como rascunho',async()=>{await go(page,'/cadences/new');await page.getByRole('button',{name:'Criar cadência'}).click();await seen(page,'Dê um nome à cadência.');await page.getByLabel('Nome da cadência').fill('[RE] Cadência nova');await page.getByText('Sem conteúdo',{exact:true}).first().click();const editor=page.locator('.step-reference-form [contenteditable="true"],.step-reference-form textarea').first();await editor.click();await page.keyboard.type('[RE] Primeira mensagem');await page.locator('.step-reference-form button[type=submit]').click();await page.getByRole('tab',{name:/Configurações/}).or(page.getByRole('button',{name:/Configurações/})).first().click();await page.getByRole('combobox',{name:/Lista vinculada/}).click();await page.getByRole('listbox',{name:/Lista vinculada/}).getByRole('option').nth(1).click();await page.getByRole('button',{name:'Criar cadência'}).click();await until(async()=>(await db.query('SELECT count(*)::int n FROM app.cadence WHERE workspace_id=$1',[a.workspace])).rows[0].n===1,'cadence created');assert.equal((await db.query("SELECT payload->>'status' s FROM app.cadence WHERE workspace_id=$1",[a.workspace])).rows[0].s,'draft','nothing runs');});
 },
 async retention(step){
  const a=await account('retencao',{plan:'essential'}),{page}=a;
  await step('digitar APAGAR libera e a política fica ligada',async()=>{await go(page,'/settings/privacy');await page.getByRole('switch').first().click();await page.getByRole('button',{name:/Salvar/}).click();await page.getByLabel('Digite APAGAR para confirmar').fill('APAGAR');await page.getByRole('dialog').locator('button.danger,.btn.danger').click();await page.getByRole('dialog').waitFor({state:'detached'});await page.waitForTimeout(800);await go(page,'/settings/privacy');await seen(page,/Ligada: enviadas após/);});
 },
 async 'cadence-edit'(step){
  const a=await account('edicao',{plan:'pro'}),{page}=a,list=randomUUID(),id=randomUUID();await db.query('INSERT INTO app.list VALUES($1,$2,$3)',[a.workspace,list,'[RE] Lista edição']);
  await db.query('INSERT INTO app.cadence(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[a.workspace,id,list,{id,name:'[RE] Para editar',listId:list,status:'draft',createdAt:new Date().toISOString(),settings:defaultCadenceSettings(),steps:[{id:'s1',channel:'WHATSAPP',delayDays:1,body:'[RE] Texto antigo',stopOnReply:true}]}]);
  const body=async()=>(await db.query('SELECT payload FROM app.cadence WHERE workspace_id=$1 AND id=$2',[a.workspace,id])).rows[0].payload.steps[0].body;
  await step('edita o passo, salva e persiste',async()=>{await go(page,'/cadences/'+id);await page.getByText('[RE] Texto antigo').first().click();const editor=page.locator('.step-reference-form [contenteditable="true"],.step-reference-form textarea').first();await editor.click();await page.keyboard.press('Control+a');await page.keyboard.type('[RE] Texto novo');await page.locator('.step-reference-form button[type=submit]').click();await page.getByRole('button',{name:'Salvar alterações'}).first().click();await until(async()=>(await body()).includes('[RE] Texto novo'),'saved');});
  await step('recarregar mantém o texto',async()=>{await go(page,'/cadences/'+id);await seen(page,'[RE] Texto novo');});
 },
 async 'select-fields'(step){
  const a=await account('seletores'),{page}=a;
  const {cadenceName}=await seedExecutionDiary(db,a.workspace,a.user,1);
  const captures='output/playwright/visual-audit';
  mkdirSync(captures,{recursive:true});
  await page.setViewportSize({width:1920,height:855});
  await go(page,'/cadences/pipeline');
  const picker=page.getByRole('combobox',{name:'Cadência',exact:true});
  await step('Pipeline abre o menu do app e confirma cadência com teclado',async()=>{
   await picker.waitFor();
   assert.equal(await picker.getAttribute('aria-expanded'),'false');
   await page.screenshot({path:captures+'/selectors-pipeline-empty-1920.png',animations:'disabled'});
   await picker.focus();
   await page.keyboard.press('Enter');
   const menu=page.getByRole('listbox',{name:'Cadência',exact:true});
   await menu.getByRole('option',{name:cadenceName,exact:true}).waitFor();
   await page.screenshot({path:captures+'/selectors-pipeline-1920.png',animations:'disabled'});
   await page.keyboard.press('ArrowDown');
   await page.keyboard.press('Enter');
   await page.getByText('1 · EMAIL',{exact:true}).waitFor();
   assert.equal(await picker.getAttribute('aria-expanded'),'false');
   assert.equal(await picker.evaluate(element=>element===document.activeElement),true);
  });
  if(await picker.getAttribute('aria-expanded')===null)return;
  await step('Escape fecha apenas o seletor e preserva a escolha no celular',async()=>{
   await page.setViewportSize({width:320,height:700});
   await picker.click();
   const menu=page.getByRole('listbox',{name:'Cadência',exact:true});
   await menu.waitFor();
   const box=await menu.boundingBox();
   assert.ok(box&&box.x>=0&&box.x+box.width<=320&&box.y>=0&&box.y+box.height<=700,'menu inteiro no viewport');
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:captures+'/selectors-pipeline-390.png',animations:'disabled'});
   await page.keyboard.press('Home');
   await page.keyboard.press('Escape');
   await menu.waitFor({state:'hidden'});
   await page.getByText('1 · EMAIL',{exact:true}).waitFor();
  });
  await step('Tab confirma a opção destacada e avança o foco',async()=>{
   await picker.focus();
   await page.keyboard.press('Enter');
   await page.keyboard.press('Home');
   await page.keyboard.press('Tab');
   await page.getByRole('heading',{name:'Escolha uma cadência'}).waitFor({timeout:5000});
   assert.equal(await picker.evaluate(element=>element!==document.activeElement),true);
   await page.screenshot({path:captures+'/selectors-pipeline-empty-390.png',animations:'disabled'});
  });
  await step('selecionar canal no formulário mantém a edição no diálogo',async()=>{
   await go(page,'/templates');
   await page.getByRole('button',{name:/Novo template|Criar template/}).first().click();
   const dialog=page.getByRole('dialog');
   const channel=dialog.getByRole('combobox',{name:'Canal',exact:true});
   await channel.click();
   await dialog.getByRole('option',{name:'WhatsApp',exact:true}).click();
   assert.match(await channel.innerText(),/WhatsApp/);
   await channel.click();
   await page.keyboard.press('Escape');
   await dialog.waitFor();
   await page.keyboard.press('Escape');
   await dialog.waitFor({state:'hidden'});
  });
  await step('lista obrigatória mantém validação sem submeter o gerador',async()=>{
   await go(page,'/leads/generator');
   await page.getByRole('button',{name:'Usar existente'}).click();
   const list=page.getByRole('combobox',{name:'Lista existente'});
   await list.click();
   await page.getByRole('option',{name:'Selecione uma lista',exact:true}).click();
   const native=page.locator('.prospecting-destination select[required]');
   assert.equal(await native.evaluate(element=>element.checkValidity()),false);
   await page.getByRole('alert').filter({hasText:'Selecione uma opção.'}).waitFor();
   assert.equal(await list.evaluate(element=>element===document.activeElement),true);
   await list.click();
   await page.getByRole('option',{name:'[RE] Diário',exact:true}).click();
   assert.equal(await native.evaluate(element=>element.checkValidity()),true);
  });
 },
 async 'remaining-visual'(step){
  const {page}=await account('visual'),captures='output/playwright/visual-audit';
  mkdirSync(captures,{recursive:true});
  async function capture(route){
   for(const [width,height] of [[1920,855],[390,844]]){
    await page.setViewportSize({width,height});
    await page.screenshot({path:`${captures}/08a6-${route}-${width}.png`,fullPage:width===390,animations:'disabled'});
   }
  }
  await step('Cadências mostra a faixa de hoje e o filtro de arquivadas',async()=>{
   await go(page,'/cadences');
   await page.locator('.cadence-today').getByRole('heading',{name:'Hoje',exact:true}).waitFor({timeout:5000});
   await page.getByText('Ficam pra depois',{exact:false}).waitFor({timeout:5000});
   await capture('cadences');
   await page.getByRole('button',{name:'Filtros',exact:true}).click({timeout:5000});
   await page.getByRole('button',{name:'Ver arquivadas',exact:true}).click({timeout:5000});
   await page.getByRole('button',{name:'Arquivadas',exact:true}).waitFor({timeout:5000});
  });
  await step('cadência nova mostra Sem conteúdo e abre a edição pelo nó',async()=>{
   await go(page,'/cadences/new');
   await capture('cadences-new');
   await page.getByText('Sem conteúdo',{exact:true}).first().click({timeout:5000});
   await page.locator('.step-reference-form').waitFor({timeout:5000});
  });
  await step('fontes disponíveis mostram os ícones e preservam as opções desabilitadas',async()=>{
   await go(page,'/automations/new');
   const maps=page.getByRole('radio',{name:/Google Maps/});
   await maps.locator('.source-icon svg[data-source="MAPS"]').waitFor({timeout:5000});
   assert.equal(await page.getByRole('radio',{name:/CNPJ por termo/}).isDisabled(),true);
   await capture('automations-new');
  });
  await step('Importar Leads mostra o limite real por lote no aviso',async()=>{
   await go(page,'/leads/import');
   await page.getByRole('note',{name:'Limites de importação'}).getByText('Máximo de 500 contatos por lote.').waitFor({timeout:5000});
   await capture('leads-import');
  });
  await step('E-mail sem caixa de entrada mostra aviso e ação de conexão',async()=>{
   await go(page,'/inbox');
   await page.getByText('Nenhuma conta de e-mail configurada para receber mensagens.',{exact:true}).waitFor({timeout:5000});
   await page.getByRole('link',{name:'Conectar e-mail',exact:true}).waitFor({timeout:5000});
   await capture('inbox');
  });
  await step('caixa configurada em atenção mantém o aviso de falha de sincronização',async()=>{
   const endpoint='**/api/mailboxes';
   await page.route(endpoint,route=>route.fulfill({json:[{id:'re-qa',name:'[RE] Caixa',provider:'smtp-imap',state:'attention',readVerified:true,syncState:'error'}]}));
   try{
    await go(page,'/inbox');
    await page.getByText('A caixa de e-mail conectada precisa de atenção.',{exact:true}).waitFor({timeout:5000});
    assert.equal(await page.getByText('Nenhuma conta de e-mail configurada para receber mensagens.',{exact:true}).count(),0);
   }finally{await page.unroute(endpoint);}
  });
  await step('Membros exibe assentos usados e capacidade do plano',async()=>{
   await go(page,'/settings/seats');
   await page.locator('.members-status').getByText(/1 de \d+ assentos/).waitFor({timeout:5000});
   await capture('members');
  });
  await step('Primeiros passos agrupa título e progresso no mesmo cartão em desktop e celular',async()=>{
   for(const [width,height] of [[1920,855],[390,844]]){
    await page.setViewportSize({width,height});
    await go(page,'/first-steps');
    const progress=page.getByRole('progressbar',{name:'Primeiros passos concluídos'});
    await progress.waitFor({timeout:7000});
    assert.equal(await progress.getAttribute('aria-valuenow'),'0');
    assert.equal(await progress.getAttribute('aria-valuemax'),'14');
    const layout=await progress.evaluate(bar=>{
     const card=bar.closest('section'),title=card?.querySelector('h1'),count=card?.querySelector('.reference-progress-label');
     if(!title||!count)return null;
     const t=title.getBoundingClientRect(),n=count.getBoundingClientRect(),b=bar.getBoundingClientRect();
     return {sameRow:n.left>=t.right&&n.top<t.bottom,stacked:n.top>=t.bottom,barBelow:b.top>=n.bottom};
    });
    assert.ok(layout?.barBelow,'o título e o contador precisam estar no cartão, acima da barra');
    assert.equal(width===1920?layout.sameRow:layout.stacked,true);
   }
   await capture('first-steps');
  });
  await step('Primeiros passos oferece orientação pela Central de Ajuda nos dois viewports',async()=>{
   await go(page,'/first-steps');
   const card=page.getByRole('region',{name:'Precisa de ajuda para montar?'});
   const open=card.getByRole('button',{name:'Abrir a Central de Ajuda'});
   for(const [width,height] of [[1920,855],[390,844]]){
    await page.setViewportSize({width,height});
    await open.click({timeout:5000});
    const dialog=page.getByRole('dialog',{name:'Central de Ajuda'});
    await dialog.waitFor({timeout:5000});
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'detached'});
    assert.equal(await open.evaluate(button=>button===document.activeElement),true);
   }
   await go(page,'/dashboard');
   await page.getByRole('heading',{name:'Prepare com sua equipe'}).waitFor({timeout:5000});
   assert.equal(await page.getByRole('heading',{name:'Prefere que a gente monte?'}).count(),0);
  });
 },
 async 'learning-help'(step){
  const {page}=await account('aprender');
  await step('Ajuda desta tela abre guia contextual e devolve foco',async()=>{
   for(const [width,height] of [[1920,855],[390,844]]){
    await page.setViewportSize({width,height});
    await go(page,'/cadences');
    const open=page.getByRole('button',{name:'Ajuda desta tela',exact:true});
    await open.click({timeout:7000});
    const drawer=page.getByRole('dialog',{name:'Ajuda',exact:true});
    const search=drawer.getByRole('textbox',{name:'Buscar na ajuda',exact:true});
    await search.waitFor({timeout:7000});
    assert.equal(await search.evaluate(e=>e===document.activeElement),true);
    const box=await drawer.boundingBox();
    assert.ok(box&&Math.abs(box.width-Math.min(width,640))<=1&&Math.abs(box.x+box.width-width)<=1);
    await drawer.getByText('Por que minha cadência não enviou',{exact:true}).waitFor({timeout:7000});
    await page.keyboard.press('Tab');
    assert.equal(await drawer.evaluate(e=>e.contains(document.activeElement)),true);
    await page.screenshot({path:`output/playwright/visual-audit/08a8-ajuda-${width}.png`,animations:'disabled'});
    await search.fill('busca sem resultado 789');
    await drawer.getByText(/Nenhum artigo encontrado/).waitFor({timeout:7000});
    await page.keyboard.press('Escape');
    await drawer.waitFor({state:'detached',timeout:7000});
    assert.equal(await open.evaluate(e=>e===document.activeElement),true);
   }
  });
  await step('Aprender abre os primeiros passos e salva um passeio concluído',async()=>{
   await page.setViewportSize({width:1920,height:855});
   await go(page,'/dashboard');
   await page.getByRole('link',{name:'Aprender',exact:true}).click({timeout:7000});
   await page.waitForURL(u=>u.pathname==='/aprender',{timeout:7000});
   await page.getByRole('link',{name:/Fazer Primeiros passos/}).click();
   assert.equal(new URL(page.url()).hash,'#primeiros-passos');
   await page.getByRole('progressbar',{name:'Primeiros passos concluídos'}).waitFor();
   const overview=page.getByRole('region',{name:'Comece aqui'});
   await overview.getByRole('button',{name:'Ver o passeio',exact:true}).click();
   const dialog=page.getByRole('dialog');
   for(let i=0;i<9;i++)await dialog.getByRole('button',{name:'Próximo',exact:true}).click();
   await dialog.getByRole('button',{name:'Concluir',exact:true}).click();
   await overview.getByText('Passeio visto',{exact:true}).waitFor({timeout:10000});
   for(const [width,height] of [[1920,855],[390,844]]){
    await page.setViewportSize({width,height});
    await go(page,'/aprender');
    await overview.getByText('Passeio visto',{exact:true}).waitFor({timeout:7000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=1),true);
    await page.screenshot({path:`output/playwright/visual-audit/08a8-aprender-${width}.png`,animations:'disabled'});
   }
  });
 },
 async 'local-overlays'(step){
  const {page}=await account('dialogos');
  await step('período rejeita intervalo invertido e permite cancelar pelo teclado',async()=>{
   await go(page,'/dashboard');
   const opener=page.getByRole('button',{name:'Personalizado',exact:true});
   await opener.click({timeout:7000});
   const dialog=page.getByRole('dialog',{name:'Período personalizado'});
   await dialog.getByLabel('De',{exact:true}).fill('2026-10-05');
   await dialog.getByLabel('Até',{exact:true}).fill('2026-10-01');
   await dialog.getByRole('button',{name:'Aplicar período'}).click();
   await dialog.getByRole('alert').getByText(/data final após a inicial/).waitFor({timeout:7000});
   assert.equal(await dialog.getByLabel('De',{exact:true}).inputValue(),'2026-10-05');
   await page.keyboard.press('Escape');
   await dialog.waitFor({state:'detached',timeout:7000});
   assert.equal(await opener.evaluate(e=>e===document.activeElement),true);
  });
  await step('autenticador abre e cancela sem preparar pareamento',async()=>{
   await go(page,'/settings/security');
   const open=page.getByRole('button',{name:'Ativar autenticador',exact:true});
   await open.click({timeout:7000});
   const dialog=page.getByRole('dialog',{name:'Ativar autenticador'});
   await dialog.getByLabel('Senha atual').waitFor({timeout:7000});
   assert.equal(await dialog.getByRole('button',{name:'Continuar',exact:true}).isDisabled(),true);
   await page.keyboard.press('Escape');
   await dialog.waitFor({state:'detached',timeout:7000});
   assert.equal(await open.evaluate(e=>e===document.activeElement),true);
  });
 },
 async 'execution-diary'(step){
  const a=await account('diario'),{page}=a;
  const captureDir='output/playwright/visual-audit';
  const capture=async label=>{
   mkdirSync(captureDir,{recursive:true});
   for(const [width,height] of [[1920,855],[390,844]]) {
    await page.setViewportSize({width,height});
    await page.screenshot({path:`${captureDir}/diary-${label}-${width}.png`,fullPage:width===390&&label==='empty',animations:'disabled'});
   }
  };
  await go(page,'/executions');
  await page.getByRole('heading',{name:'Nenhuma execução ainda'}).waitFor({timeout:6000});
  await step('diário vazio mantém cabeçalho, cartões, busca e paginação',async()=>{
   await page.getByText('O diário das suas cadências:',{exact:false}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Próxima página'}).isDisabled(),true);
   await capture('empty');
  });
  await seedExecutionDiary(db,a.workspace,a.user,27);
  await go(page,'/executions');
  await step('diário lê mensagens terminais de cadência e mostra o motivo',async()=>{
   const main=page.getByRole('main');
   await main.getByText('27 resultados',{exact:true}).waitFor();
   for(const event of ['Mensagem aceita pelo provedor.','Falha no envio.','O contato já respondeu.'])
    assert.equal(await main.getByText(event,{exact:true}).count(),9);
   await capture('rows');
  });
  await step('tamanho de página e navegação exibem a última página',async()=>{
   await page.getByRole('combobox',{name:'Por página'}).click();
   await page.getByRole('option',{name:'25',exact:true}).click();
   const rows=page.getByRole('table',{name:'Diário das cadências'}).locator('tbody tr');
   await until(async()=>await rows.count()===25,'25 mensagens na primeira página');
   await page.getByRole('button',{name:'Próxima página'}).click();
   await page.getByText('2 / 2',{exact:true}).waitFor();
   assert.equal(await rows.count(),2);
   assert.equal(await page.getByRole('button',{name:'Próxima página'}).isDisabled(),true);
  });
  await step('filtros funcionam por teclado e a busca recupera a lista',async()=>{
   const status=page.getByRole('combobox',{name:'Status'});
   await status.focus();
   await page.keyboard.press('Enter');
   await page.getByRole('option',{name:'Erro',exact:true}).waitFor();
   await page.keyboard.press('Escape');
   assert.equal(await status.evaluate(el=>el===document.activeElement),true);
   await page.keyboard.press('Enter');
   await page.keyboard.press('ArrowDown');
   await page.keyboard.press('ArrowDown');
   await page.keyboard.press('Enter');
   await page.getByText('9 resultados',{exact:true}).waitFor();
   assert.equal(await page.getByText('Mensagem aceita pelo provedor.',{exact:true}).count(),0);
   const search=page.getByRole('searchbox',{name:'Buscar execuções'});
   await search.fill('sem correspondência');
   await page.getByRole('heading',{name:'Nenhuma execução para estes filtros'}).waitFor();
   await search.fill('[RE] Diário Ágata');
   await page.getByText('Falha no envio.',{exact:true}).first().waitFor();
   await page.setViewportSize({width:320,height:800});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  });
  await step('falha de leitura oferece nova tentativa com recuperação',async()=>{
   const endpoint='**/api/execution-diary?*';
   await page.route(endpoint,r=>r.fulfill({status:503,json:{message:'Serviço indisponível. Tente novamente.'}}),{times:1});
   await go(page,'/executions');
   await page.getByRole('alert').filter({hasText:'Serviço indisponível'}).waitFor();
   await page.getByRole('button',{name:'Tentar novamente'}).click();
   await page.getByText('27 resultados',{exact:true}).waitFor();
   assert.equal(await page.getByRole('alert').filter({hasText:'Serviço indisponível'}).count(),0);
  });
 },
 async 'execution-states'(step){
  const a=await account('estados',{plan:'pro'}),{page}=a,list=randomUUID();await db.query('INSERT INTO app.list VALUES($1,$2,$3)',[a.workspace,list,'[RE] Lista estados']);
  // Terminal states only: a worker can claim queued or running jobs and would call the paid provider.
  const job=async(state,counts)=>{const id=randomUUID();await db.query('INSERT INTO app.prospecting_job(workspace_id,id,actor_id,list_id,request_id,body_hash,kind,source,state,input,profile_version,checkpoint,counts) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[a.workspace,id,a.user,list,randomUUID(),'fixture','generation','MAPS',state,{kind:'generation',source:'MAPS',destination:{mode:'existing',listId:list},filters:{term:'[RE] fixture',location:'QA'},limit:2,dedupScope:'workspace'},'fixture',{fixture:true,context:null},counts]);return id;};
  const failed=await job('failed',{found:0,inserted:0,duplicates:0,rejected:0,pending:0}),partial=await job('partial',{found:2,inserted:1,duplicates:0,rejected:1,pending:0}),done=await job('completed',{found:1,inserted:1,duplicates:0,rejected:0,pending:0});
  await step('falha aparece como falha',async()=>{await go(page,'/executions/'+failed);await seen(page,/Falhou|Falha/);});
  await step('parcial aparece como parcial, com as contagens',async()=>{await go(page,'/executions/'+partial);await seen(page,/Parcial|parcial/);await seen(page,'1 rejeitados');});
  await step('em andamento (resposta simulada) mostra progresso',async()=>{await page.route('**/api/prospecting/jobs/'+done+'*',async r=>{const res=await r.fetch();const j=await res.json();const patch=o=>{if(o&&typeof o==='object'){if('state'in o)o.state='running';for(const v of Object.values(o))patch(v);}};patch(j);await r.fulfill({response:res,json:j});});await go(page,'/executions/'+done);await seen(page,/Processando|Em processamento|Em andamento|Executando/);await page.unroute('**/api/prospecting/jobs/'+done+'*');});
 },
 async 'onboarding-finish'(step){
  const a=await account('completa'),{page}=a;
  await step('aceitar conclui o cadastro e libera o app',async()=>{await db.query('UPDATE auth."user" SET "registrationRequired"=true WHERE id=$1',[a.user]);await go(page,'/onboarding/entry');await page.getByLabel('Telefone').fill('(21) 97323-1943');await page.getByRole('checkbox').first().check();await page.getByRole('button',{name:/Continuar|Salvar|Concluir/}).first().click();await page.waitForURL(u=>!u.pathname.startsWith('/onboarding/profile'),{timeout:30000});assert.equal((await db.query('SELECT "registrationRequired" r FROM auth."user" WHERE id=$1',[a.user])).rows[0].r,false);});
 },
 async admin(step){
  const a=await account('dono-adm',{plan:'pro',paid:true}),admin=await account('admin'),op=await account('operador2');
  for(const [who,role] of [[admin,'admin'],[op,'operator']]){await who.page.goto('about:blank');await db.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),a.workspace,who.user,role]);const r=await who.page.request.post(origin+'/api/identity',{headers:{origin,'content-type':'application/json'},data:{type:'switch',workspaceId:a.workspace}});assert.equal(r.status(),200);}
  const post=(who,path,data)=>who.page.request.post(origin+path,{headers:{origin,'content-type':'application/json','x-cadence-workspace':a.workspace},data});
  await step('administrador pode preparar cobrança',async()=>{assert.equal((await post(admin,'/api/billing/prepare',{kind:'checkout',sku:'extractions-2000'})).status(),200);});
  await step('operador não convida e o administrador convida',async()=>{const refused=await post(op,'/api/identity',{type:'invite',requestId:randomUUID(),email:'nao@example.com',role:'operator'});console.log('    operator invite',refused.status(),(await refused.text()).slice(0,120));assert.ok([401,403].includes(refused.status()));const ok=await post(admin,'/api/identity',{type:'invite',requestId:randomUUID(),email:'re-qa-convite@example.com',role:'operator'});const text=await ok.text();assert.ok(ok.status()===200||(ok.status()===409&&text.includes('BILLING_CAPACITY')),'the admin is authorized: only the seat limit may answer');});
  await step('operador não cria chave de API',async()=>{const input={action:'create-key',input:{name:'[RE] chave',scopes:['leads:read']}};assert.equal((await post(op,'/api/integrations',input)).status(),403);const ok=await post(admin,'/api/integrations',input);assert.ok(ok.ok(),'the admin creates with the same call: '+ok.status());});
  await step('operador não muda a privacidade',async()=>{const input={action:'retention',input:{active:true,sentDays:365,replyDays:365,expectedRevision:0,confirm:'APAGAR'}},r=await post(op,'/api/data-lifecycle',input);assert.equal(r.status(),403,await r.text());const ok=await post(a,'/api/data-lifecycle',input);assert.ok(ok.ok(),'the owner saves with the same call: '+ok.status());});
  await step('operador trabalha nos contatos',async()=>{const r=await op.page.request.get(origin+'/api/contacts',{headers:{'x-cadence-workspace':a.workspace}});assert.equal(r.status(),200);});
  await step('nas caixas, a ação de conexão aparece para administrador e some para operador',async()=>{
   for(const [path,title,action] of [
    ['/inbox','Conecte uma conta de e-mail','Conectar e-mail'],
    ['/messages/whatsapp','WhatsApp não configurado','Conectar WhatsApp'],
   ]){
    await go(admin.page,path);
    await admin.page.getByRole('heading',{name:title,exact:true}).waitFor();
    await admin.page.getByRole('link',{name:action,exact:true}).waitFor();
    await go(op.page,path);
    await op.page.getByRole('heading',{name:title,exact:true}).waitFor();
    assert.equal(await op.page.getByRole('link',{name:action,exact:true}).count(),0);
   }
  });
  await step('Membros bloqueia o formulário para operador e habilita para administrador',async()=>{
   for(const who of [admin,op]){
    await go(who.page,'/settings/seats');
    const field=who.page.getByRole('textbox',{name:'E-mail',exact:true});
    await field.waitFor();
    assert.equal(await field.isDisabled(),who===op);
    if(who===admin){
     await field.fill('re-qa-papel@example.com');
     assert.equal(await who.page.getByRole('button',{name:'Convidar',exact:true}).isEnabled(),true);
    }
   }
  });
  await step('Privacidade mostra política ao dono e a restringe ao administrador e operador',async()=>{
   await go(a.page,'/settings/privacy');
   await a.page.getByRole('switch').waitFor();
   for(const who of [admin,op]){
    await go(who.page,'/settings/privacy');
    await who.page.getByText('Só o dono da conta',{exact:true}).waitFor();
    assert.equal(await who.page.getByRole('switch').count(),0);
   }
  });
  await step('controles administrativos de e-mail, API, Apollo, Agenda e Sheets respeitam o papel',async()=>{
   for(const [path,heading,action,denied] of [
    ['/settings/email','Contas de e-mail','Conectar e-mail','A configuração das caixas exige um administrador.'],
    ['/settings/webhooks','Webhooks e API','Nova chave',/Somente proprietário ou administrador gerencia (webhooks|chaves de API)\./],
    ['/settings/apps/apollo','Apollo','Conectar','Somente proprietário ou administrador conecta o Apollo.'],
    ['/settings/apps/google-calendar','Google Agenda','Conectar conta Google','Somente proprietário ou administrador conecta o Google.'],
    ['/settings/apps/google-sheets','Google Sheets','Conectar conta Google','Somente proprietário ou administrador conecta o Google.'],
   ]){
    for(const who of [a,admin,op]){
     await go(who.page,path);
     await who.page.getByRole('heading',{name:heading,exact:true}).first().waitFor({timeout:7000});
     const button=who.page.getByRole('button',{name:action,exact:true});
     if(who===op){
      await who.page.getByText(denied,{exact:false}).first().waitFor({timeout:7000});
      assert.equal(await button.count()===0||await button.isDisabled(),true,path+' deixou a ação disponível ao operador');
      if(path==='/settings/webhooks')assert.equal(await who.page.getByRole('button',{name:'Novo webhook',exact:true}).isDisabled(),true);
     }else{
      await button.waitFor({timeout:7000});
      if(path==='/settings/apps/apollo')await who.page.getByPlaceholder('Cole a chave aqui').fill('[RE] chave fictícia sem envio');
      await until(()=>button.isEnabled(),path+' manteve a ação bloqueada');
      if(path==='/settings/webhooks')assert.equal(await who.page.getByRole('button',{name:'Novo webhook',exact:true}).isEnabled(),true);
     }
    }
   }
  });
 },
 async 'keyboard-more'(step){
  const a=await account('teclado2',{plan:'pro'}),{page}=a;
  for(const route of ['/contacts','/cadences','/templates','/leads/generator','/reports','/settings/account','/settings/webhooks','/sdr'])await step('Tab com foco visível em '+route,async()=>{await go(page,route);for(let i=0;i<12;i++){await page.keyboard.press('Tab');const f=await page.evaluate(()=>{const e=document.activeElement;if(!e||e===document.body)return null;const look=()=>{const s=getComputedStyle(e);return [s.outlineStyle,s.outlineWidth,s.boxShadow,s.borderColor,s.backgroundColor].join('|');},on=look();e.blur();const off=look();e.focus();return {changes:on!==off,tag:e.tagName+'.'+e.className+' '+(e.innerText||'').slice(0,20)};});assert.ok(f,'lost focus');assert.ok(f.changes,'focus changes nothing on '+f.tag);}});
  await step('busca devolve o foco',async()=>{await go(page,'/dashboard');const b=page.getByRole('button',{name:/Buscar lead/});await b.focus();await page.keyboard.press('Enter');await page.getByRole('dialog').first().waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});assert.ok(await b.evaluate(e=>e===document.activeElement),'focus lost');});
  await step('assistente devolve o foco',async()=>{const b=page.getByRole('button',{name:'Assistente'});await b.focus();await page.keyboard.press('Enter');await page.locator('.assistant-panel').waitFor();await page.keyboard.press('Escape');await page.locator('.assistant-panel').waitFor({state:'detached'});assert.ok(await b.evaluate(e=>e===document.activeElement),'focus lost');});
 },
 async 'network-more'(step){
  const a=await account('rede2',{plan:'pro'}),{page}=a,list=randomUUID();await db.query('INSERT INTO app.list VALUES($1,$2,$3)',[a.workspace,list,'[RE] Lista rede']);await lead(a.workspace,list,{name:'[RE] Contato visível'});
  const down=(glob,method='GET')=>page.route(glob,r=>r.request().method()===method?r.fulfill({status:503,contentType:'application/json',body:'{}'}):r.fallback());
  await step('leitura de contatos em 503 mostra erro e tenta de novo',async()=>{await down('**/api/contacts*');await go(page,'/contacts');const retry=page.getByRole('button',{name:'Tentar novamente'}).first();await retry.waitFor({timeout:20000});await page.unroute('**/api/contacts*');await retry.click();await seen(page,'[RE] Contato visível');});
  await step('formulário de chave em 503 mantém o rascunho e o foco no diálogo',async()=>{await go(page,'/settings/webhooks');await page.getByRole('button',{name:'Nova chave'}).click();const dialog=page.getByRole('dialog');const field=dialog.getByRole('textbox').first();await field.fill('[RE] Chave rascunho');await down('**/api/integrations','POST');await dialog.getByRole('button',{name:/Criar|Gerar/}).click();await page.waitForTimeout(1500);await page.unroute('**/api/integrations');assert.equal(await field.inputValue(),'[RE] Chave rascunho');assert.ok(await dialog.evaluate(d=>d.contains(document.activeElement)),'focus left the dialog');assert.ok((await dialog.innerText()).match(/Não foi possível|indispon|Tente/i),'no error in the dialog');});
  await step('relatório em 503 avisa e recupera',async()=>{await down('**/api/reports*');await go(page,'/reports');const failure=page.getByText('Não foi possível consultar os relatórios');await failure.waitFor({timeout:20000});await page.unroute('**/api/reports*');await go(page,'/reports');await seen(page,'Os relatórios aparecem depois do primeiro envio');assert.equal(await failure.count(),0,'the error stayed after recovery');});
  await step('template em 503 mantém texto, seletor e foco',async()=>{
   await go(page,'/templates');
   await page.getByRole('button',{name:/Novo template|Criar template/}).first().click();
   const dialog=page.getByRole('dialog',{name:'Novo template'});
   const name=dialog.getByRole('textbox',{name:'Nome *',exact:true}),body=dialog.getByRole('textbox',{name:'Corpo *',exact:true});
   await name.fill('[RE] Template indisponível');
   await body.fill('[RE] Corpo da mensagem');
   const channel=dialog.getByRole('combobox',{name:'Canal',exact:true});
   await channel.click();
   await dialog.getByRole('option',{name:'WhatsApp',exact:true}).click();
   const route='**/api/workspace/commands';
   await page.route(route,r=>r.fulfill({status:503,json:{message:'[RE] Não foi possível salvar o template.'}}));
   try{
    const failure=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/workspace/commands'&&r.status()===503);
    await dialog.getByRole('button',{name:'Criar template',exact:true}).click();
    await failure;
    await seen(page,'[RE] Não foi possível salvar o template.');
    assert.equal(await name.inputValue(),'[RE] Template indisponível');
    assert.equal(await body.inputValue(),'[RE] Corpo da mensagem');
    assert.match(await channel.innerText(),/WhatsApp/);
    assert.equal(await dialog.evaluate(element=>element.contains(document.activeElement)),true);
    assert.equal((await db.query('SELECT count(*)::int n FROM app.template WHERE workspace_id=$1',[a.workspace])).rows[0].n,0);
   }finally{await page.unroute(route);}
  });
 },
 async 'mail-config'(step){
  const {page,workspace}=await account('caixas',{plan:'pro'});
  const endpoint='**/api/mailboxes';
  await step('503 da lista de caixas encerra o carregamento e permite nova tentativa',async()=>{
   const fail=route=>route.request().method()==='GET'
    ?route.fulfill({status:503,json:{message:'[RE] Caixa temporariamente indisponível.'}})
    :route.fallback();
   await page.route(endpoint,fail);
   try{
    await go(page,'/settings/email');
    await seen(page,'[RE] Caixa temporariamente indisponível.');
    assert.equal(await page.getByText('Consultando caixas…',{exact:true}).count(),0);
   }finally{await page.unroute(endpoint,fail);}
   const retried=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/mailboxes'&&r.request().method()==='GET',{timeout:3000});
   await page.getByRole('button',{name:'Atualizar',exact:true}).click();
   assert.equal((await retried).status(),200);
   await page.getByRole('heading',{name:'Nenhuma caixa conectada'}).waitFor({timeout:7000});
   assert.equal(await page.getByText('[RE] Caixa temporariamente indisponível.',{exact:true}).count(),0);
  });
  await step('Gmail e SMTP fecham com Escape e devolvem foco ao botão de conexão',async()=>{
   for(const [width,height,choice,title] of [[1920,855,/Gmail \/ Google Workspace/,'Adicionar caixa Google'],[390,844,/SMTP \+ IMAP/,'Adicionar SMTP + IMAP']]){
    await page.setViewportSize({width,height});
    await go(page,'/settings/email');
    const opener=page.getByRole('button',{name:'Conectar e-mail',exact:true});
    await opener.click();
    await page.getByRole('dialog',{name:'Conectar e-mail'}).getByRole('button',{name:choice}).click();
    const dialog=page.getByRole('dialog',{name:title});
    await dialog.getByRole('textbox',{name:'Nome da caixa',exact:true}).waitFor({timeout:7000});
    assert.equal(await dialog.evaluate(element=>element.contains(document.activeElement)),true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden',timeout:7000});
    assert.equal(await opener.evaluate(element=>element===document.activeElement),true);
   }
  });
  await step('503 ao salvar uma caixa Google preserva o formulário e o foco',async()=>{
   await go(page,'/settings/email');
   await page.getByRole('button',{name:'Conectar e-mail',exact:true}).click();
   await page.getByRole('button',{name:/Gmail \/ Google Workspace/}).click();
   const dialog=page.getByRole('dialog',{name:'Adicionar caixa Google'}),name=dialog.getByRole('textbox',{name:'Nome da caixa',exact:true});
   await name.fill('[RE] Caixa rascunho');
   const fail=route=>route.request().method()==='POST'
    ?route.fulfill({status:503,json:{message:'[RE] Não foi possível salvar a caixa.'}})
    :route.fallback();
   await page.route(endpoint,fail);
   try{
    await dialog.getByRole('button',{name:'Salvar configuração',exact:true}).click();
    await dialog.getByRole('alert').getByText('[RE] Não foi possível salvar a caixa.',{exact:true}).waitFor({timeout:7000});
    assert.equal(await name.inputValue(),'[RE] Caixa rascunho');
    assert.equal(await dialog.evaluate(element=>element.contains(document.activeElement)),true);
    assert.equal((await db.query('SELECT count(*)::int n FROM app.email_mailbox WHERE workspace_id=$1',[workspace])).rows[0].n,0);
   }finally{await page.unroute(endpoint,fail);}
  });
 },
 async 'reports-data'(step){
  const a=await account('relatorios',{plan:'pro'}),{page}=a,list=randomUUID();await db.query('INSERT INTO app.list VALUES($1,$2,$3)',[a.workspace,list,'[RE] Lista relatório']);for(let i=0;i<7;i++)await lead(a.workspace,list,{name:'[RE] Relatório '+i});
  await step('o funil conta os contatos reais',async()=>{await go(page,'/reports/funnel');const card=page.locator('.reports-funnel-metrics section',{hasText:'Total Leads'});await until(async()=>/\b7\b/.test(await card.innerText()),'seven contacts on the card');});
  await step('funil segura 320 px com contatos',async()=>{await page.setViewportSize({width:320,height:700});await go(page,'/reports/funnel');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);await page.setViewportSize({width:1440,height:900});});
  const {cadenceName}=await seedExecutionDiary(db,a.workspace,a.user);
  await step('envios registrados aparecem no total e no filtro de cadência',async()=>{
   await go(page,'/reports');
   const sent=page.getByRole('button',{name:'Ver registros de E-mails aceitos',exact:true});
   await until(async()=>await sent.innerText()==='2','duas mensagens aceitas registradas incluindo a avulsa');
   await page.getByRole('combobox',{name:'Cadência',exact:true}).click();
   await page.getByRole('option',{name:cadenceName,exact:true}).click();
   await until(async()=>await sent.innerText()==='1','a mensagem avulsa fica fora do recorte da cadência');
   await sent.click();
   const dialog=page.getByRole('dialog',{name:'Detalhe do indicador'});
   await dialog.getByRole('cell',{name:'accepted',exact:true}).waitFor();
   const row=dialog.locator('tbody tr');
   assert.equal(await dialog.locator('tbody tr').count(),1);
   assert.match(await row.innerText(),/EMAIL/);
   await page.keyboard.press('Escape');
   await dialog.waitFor({state:'hidden'});
   assert.equal(await sent.evaluate(element=>element===document.activeElement),true);
  });
 },
 async 'module-popups'(step){
  const a=await account('popups2',{plan:'pro'}),{page}=a,list=randomUUID();await db.query('INSERT INTO app.list VALUES($1,$2,$3)',[a.workspace,list,'[RE] Lista popups']);await lead(a.workspace,list);
  const open=async(route,click,name)=>step(name,async()=>{await go(page,route);await click();const d=page.getByRole('dialog').first();await d.waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);await page.keyboard.press('Escape');await d.waitFor({state:'detached'});});
  await open('/contacts',()=>page.getByRole('button',{name:'Excluir por e-mail'}).click(),'contatos: excluir por e-mail');
  await open('/contacts',()=>page.getByRole('button',{name:'Colunas'}).click(),'contatos: colunas');
  await open('/settings/webhooks',()=>page.getByRole('button',{name:'Novo webhook'}).click(),'webhooks: novo');
  await open('/settings/webhooks',()=>page.getByRole('button',{name:'Nova chave'}).click(),'API: nova chave');
  await open('/templates',()=>page.getByRole('button',{name:/Novo template|Criar template/}).first().click(),'templates: novo');
  await open('/settings/plan',async()=>{await page.getByRole('tab',{name:'Planos e pacotes'}).click();await page.locator('.billing-comparison-plan').first().getByRole('button').click();},'plano: revisão');
  await open('/cadences',()=>page.getByRole('button',{name:/Nova cadência/}).first().click(),'cadências: nova');
  await open('/settings/context',()=>page.getByRole('button',{name:/produto/i}).first().click(),'contexto: produto');
  await open('/settings/email',()=>page.getByRole('button',{name:/Conectar|Adicionar/}).first().click(),'e-mail: conectar');
  await open('/settings/whatsapp',()=>page.getByRole('button',{name:/Conectar|Adicionar/}).first().click(),'WhatsApp: conectar');
  await open('/reports',()=>page.getByRole('button',{name:'Leia o guia na Central de Ajuda'}).click(),'relatórios: guia');
  await open('/cadences',()=>page.getByRole('button',{name:/entender por quê/i}).click(),'cadências: previsão de hoje');
  await open('/cadences/new',()=>page.getByRole('button',{name:'Adicionar etapa no final',exact:true}).click(),'cadência: adicionar etapa');
  await open('/leads/generator',async()=>{
   await page.getByRole('textbox',{name:'Descrever público para sugestão de IA'}).fill('[RE] Empresas fictícias');
   await page.getByRole('button',{name:'Sugerir com IA',exact:true}).click();
  },'gerador: abrir sugestão de IA sem confirmar');
  await step('sem canal, as caixas levam à conexão',async()=>{await go(page,'/messages/whatsapp');await page.getByRole('link',{name:'Conectar WhatsApp'}).click();await page.waitForURL(u=>u.pathname==='/settings/whatsapp');await go(page,'/inbox');await page.getByRole('link',{name:'Conectar e-mail'}).click();await page.waitForURL(u=>u.pathname==='/settings/email');});
 },
 async onboarding(step){
  const a=await account('incompleto'),{page}=a;
  await step('cadastro incompleto vai para o complemento',async()=>{await db.query('UPDATE auth."user" SET "registrationRequired"=true WHERE id=$1',[a.user]);await go(page,'/onboarding/entry');await page.waitForURL(u=>u.pathname==='/onboarding/profile',{timeout:20000});await page.getByLabel('Telefone').waitFor();});
  await step('não sai de lá sem aceitar',async()=>{const submit=page.getByRole('button',{name:/Continuar|Salvar|Concluir/}).first();await page.getByLabel('Telefone').fill('(21) 97323-1943');assert.equal(await submit.isDisabled(),true,'cannot continue before accepting');assert.ok(new URL(page.url()).pathname==='/onboarding/profile');});
 },
};
const runs=[];
// What each journey is meant to provoke. Anything else on the page fails it.
const allowed={pack:[/^422 POST \/api\/billing\/prepare$/],network:[/^503 POST \/api\/workspace\/commands$/],roles:[/^403 POST \/api\/billing\/prepare$/,/^40[39] GET /],onboarding:[/^403 GET /],'onboarding-finish':[/^403 GET /],admin:[/^409 GET /,/^403 GET \/api\/integrations$/],'network-more':[/^503 GET \/api\/(contacts|reports)/,/^503 POST \/api\/(integrations|workspace\/commands)$/],'execution-diary':[/^503 GET \/api\/execution-diary$/],'mail-config':[/^503 (GET|POST) \/api\/mailboxes$/],'cadence-editor':[/^503 POST \/api\/workspace\/commands$/]};
try{
 if(!only||only==='signup')await new Promise(w=>setTimeout(w,70000));
 for(const [id,run] of Object.entries(journeys)){
  if(only&&!only.split(',').includes(id))continue;
  const local=[];const step=async(name,fn)=>{try{await fn();local.push({name,ok:true});console.log('  ok',id,'·',name);}catch(e){local.push({name,ok:false,error:String(e.message).split('\n')[0].slice(0,240)});console.log('  FAIL',id,'·',name,'·',String(e.message).split('\n')[0].slice(0,240));const pages=browser.contexts().flatMap(c=>c.pages());await pages.at(-1)?.screenshot({path:`${out}/journey-failures/${id}-${local.length}.jpg`,type:'jpeg',quality:60}).catch(()=>{});}};
  issues=[];let crash=null;try{await run(step);}catch(e){crash=String(e.message).split('\n')[0].slice(0,240);console.log('  CRASH',id,crash);}
  for(const c of open.splice(0))await c.close().catch(()=>{});
  const unexpected=[...new Set(issues)].filter(x=>!(allowed[id]??[]).some(r=>r.test(x)));if(unexpected.length)console.log('  UNEXPECTED',id,unexpected.join(', ').slice(0,300));
  runs.push({id,ok:!crash&&!unexpected.length&&local.length>0&&local.every(s=>s.ok),crash,unexpected,steps:local});
  await new Promise(w=>setTimeout(w,1000));
 }
 if(sourceHash()!==hash)throw Error('The code changed during the run; its results measure nothing.');
 if(!only)writeFileSync(out+'/journeys.json',JSON.stringify({date:new Date().toISOString(),sourceHash:hash,note:'Navegador sem acesso a outros hosts; contas sem canais ativos; nada enviado; sem IA ou pesquisa paga; nenhuma confirmação no Stripe.',runs},null,1)+'\n');
 console.log(`${runs.filter(r=>r.ok).length}/${runs.length} journeys ok`);
 if(runs.some(r=>!r.ok)||!runs.length)process.exitCode=1;
}finally{
 await browser.close();
 try {
  const residue=await removeQaAccounts(db,{
   users:created.map(x=>x.id),
   workspaces:created.filter(x=>x.owned!==false).map(x=>x.ws),
   emails:[...attemptedEmails],
  });
  console.log('residue',residue);
  if(residue!==0)process.exitCode=1;
 } finally {await db.end();}
}
