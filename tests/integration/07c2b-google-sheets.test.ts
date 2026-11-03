import test,{after,before}from'node:test';import assert from'node:assert/strict';import{randomUUID,createHash}from'node:crypto';
import{prospectingUser as createUser,testAdmin,closeProspectingPools}from'./prospecting-helpers.ts';
import{base,resetRateLimits}from'./helpers.ts';
import{executeWorkspaceCommand,readWorkspaceSnapshot}from'../../src/server/workspaces/commands.ts';
import{listConnections,disconnectIntegration}from'../../src/server/integrations/connections.ts';
import{startSheetsAuthorization,finishSheetsAuthorization,configureSheets,sheetsAction,dispatchSheetsTick,SHEETS_SCOPE,type SheetsDeps}from'../../src/server/integrations/sheets.ts';
import{integrationsRequest,integrationItemRequest}from'../../src/server/integrations/http.ts';
import type{Principal}from'../../src/domain/workspace.ts';
after(closeProspectingPools);
const callback=base+'/api/integration-oauth/google-sheets/callback',env={GOOGLE_SHEETS_CLIENT_ID:'client-qa',GOOGLE_SHEETS_CLIENT_SECRET:'secret-qa',GOOGLE_SHEETS_REDIRECT_URI:callback};
const saved:Record<string,string|undefined>={};
before(()=>{for(const [k,v] of Object.entries(env)){saved[k]=process.env[k];process.env[k]=v;}});
after(()=>{for(const k of Object.keys(env)){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
const user=async()=>{await resetRateLimits();return createUser();};
const REFRESH='refresh-token-qa-'+'r'.repeat(10),ACCESS='access-token-qa-';

/** In-memory Google: token endpoint plus the four Sheets calls the connector makes. */
function fakeGoogle(){
 const books=new Map<string,{title:string;rows:string[][]}>(),calls:string[]=[];let n=0;
 const hooks:{challenge?:string;tokens:string[];read?:()=>Response|undefined;token?:(body:URLSearchParams)=>Response|undefined;beforeWrite?:(kind:'append'|'update')=>Promise<void>|void;afterAppend?:()=>void}={tokens:[]};
 const cell=(a1:string)=>{const m=decodeURIComponent(a1).match(/^'(.+)'!A(\d+)$/);return m?{title:m[1].replace(/''/g,"'"),row:Number(m[2])}:null;};
 const fakeFetch:typeof fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input)),method=init?.method??'GET',body=init?.body?String(init.body):'';calls.push(method+' '+url.pathname);
  if(url.host==='oauth2.googleapis.com'){const params=new URLSearchParams(body);hooks.tokens.push(String(params.get('grant_type')));
   // PKCE: the code exchange must carry the verifier for the challenge sent to Google, and the registered redirect.
   if(params.get('grant_type')==='authorization_code'&&hooks.challenge){assert.equal(createHash('sha256').update(String(params.get('code_verifier'))).digest('base64url'),hooks.challenge);assert.equal(params.get('redirect_uri'),callback);}
   return hooks.token?.(params)??Response.json({access_token:ACCESS+(++n),token_type:'Bearer',expires_in:3600,scope:SHEETS_SCOPE,refresh_token:REFRESH});}
  assert.equal(url.host,'sheets.googleapis.com');assert.match(String((init?.headers as Record<string,string>).authorization),/^Bearer access-token-qa-/);
  if(method==='POST'&&url.pathname==='/v4/spreadsheets'){const b=JSON.parse(body),id='sheet'+randomUUID().replaceAll('-','');
   books.set(id,{title:b.sheets[0].properties.title,rows:[b.sheets[0].data[0].rowData[0].values.map((v:{userEnteredValue:{stringValue:string}})=>v.userEnteredValue.stringValue)]});return Response.json({spreadsheetId:id});}
  const m=url.pathname.match(/^\/v4\/spreadsheets\/([^/]+)\/values(?::batchGet|\/(.+?)(:append)?)$/);if(!m)return Response.json({error:{message:'not found'}},{status:404});
  const book=books.get(m[1]);if(!book)return Response.json({error:{message:'Requested entity was not found.'}},{status:404});
  if(url.pathname.endsWith(':batchGet')){const forced=hooks.read?.();if(forced)return forced;const [h,a]=url.searchParams.getAll('ranges');if(!decodeURIComponent(h).startsWith(`'${book.title}'`))return Response.json({error:{message:'Unable to parse range'}},{status:400});void a;
   return Response.json({valueRanges:[{values:[book.rows[0]??[]]},{values:book.rows.map(r=>[r[0]??''])}]});}
  const values=JSON.parse(body).values[0] as string[];
  assert.equal(url.searchParams.get('valueInputOption'),'RAW');
  if(m[3]){await hooks.beforeWrite?.('append');book.rows.push(values);hooks.afterAppend?.();return Response.json({});}
  const c=cell(m[2])!;await hooks.beforeWrite?.('update');book.rows[c.row-1]=values;return Response.json({});
 }) as typeof fetch;
 return{books,calls,hooks,deps:{fetch:fakeFetch} as SheetsDeps,only:()=>[...books.values()][0]};
}
async function authorize(p:Principal,g:ReturnType<typeof fakeGoogle>,deps?:SheetsDeps){
 const {authorizationUrl}=await startSheetsAuthorization(p,p.sessionId),u=new URL(authorizationUrl);g.hooks.challenge=u.searchParams.get('code_challenge')!;
 return finishSheetsAuthorization(p,p.sessionId,new URL(callback+'?state='+u.searchParams.get('state')+'&code=code-qa'),deps??g.deps);
}
const sheets=async(p:Principal)=>(await listConnections(p)).connections.find(c=>c.kind==='google-sheets')!;
const setup=(f:Record<string,unknown>={})=>({spreadsheetName:'[RE] Leads QA',sheetTitle:'Leads',columns:['name','email','qualification','event'],events:['lead.created','lead.qualified','lead.connected'],expectedRevision:0,...f});
const lead=(id:string,fields:Record<string,unknown>={})=>({id,listId:'base',name:'[RE] Contato '+id,email:id+'@example.com',qualification:'pending',source:'MANUAL',createdAt:new Date().toISOString(),...fields});
async function seed(p:Principal,leads:ReturnType<typeof lead>[]){const s=await readWorkspaceSnapshot(p);await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'leads.import',dedupScope:'list',list:{id:'base',name:'Base QA'},leads}});}
const qualify=(ws:string,id:string)=>testAdmin(c=>c.query(`UPDATE app.lead SET payload=jsonb_set(payload,'{qualification}','"qualified"') WHERE workspace_id=$1 AND id=$2`,[ws,id]));
const queue=(ws:string)=>testAdmin(async c=>(await c.query('SELECT lead_id,state,attempts FROM app.sheet_export WHERE workspace_id=$1 ORDER BY lead_id',[ws])).rows);
// Only this workspace is due: other tests may have left queued exports in the shared test database.
async function tick(ws:string,deps:SheetsDeps){
 await testAdmin(c=>c.query("UPDATE app.sheet_export SET next_at=next_at+interval '100 years' WHERE workspace_id<>$1 AND state='pending' AND next_at<now()+interval '50 years'",[ws]));
 try{return await dispatchSheetsTick({limit:20,signal:new AbortController().signal},deps);}
 finally{await testAdmin(c=>c.query("UPDATE app.sheet_export SET next_at=next_at-interval '100 years' WHERE workspace_id<>$1 AND state='pending' AND next_at>now()+interval '50 years'",[ws]));}
}
const dueNow=(ws:string)=>testAdmin(c=>c.query("UPDATE app.sheet_export SET next_at=now() WHERE workspace_id=$1 AND state='pending'",[ws]));

test('OAuth state is single-use and bound to user, session and workspace; a denied scope connects nothing; tokens never leave the server',async()=>{
 const u=await user(),v=await user(),g=fakeGoogle();
 const mate={...v.p,workspaceId:u.p.workspaceId};
 await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),mate.workspaceId,mate.userId,'admin']));
 const {authorizationUrl}=await startSheetsAuthorization(u.p,u.p.sessionId),url=new URL(authorizationUrl);g.hooks.challenge=url.searchParams.get('code_challenge')!;
 assert.equal(url.searchParams.get('scope'),SHEETS_SCOPE);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('redirect_uri'),callback);
 const back=new URL(callback+'?state='+url.searchParams.get('state')+'&code=code-qa');
 await assert.rejects(finishSheetsAuthorization(mate,mate.sessionId,back,g.deps),{status:403});
 await assert.rejects(finishSheetsAuthorization(u.p,'other-session',back,g.deps),{status:403});
 await assert.rejects(finishSheetsAuthorization(v.p,v.p.sessionId,back,g.deps),{status:403});
 await finishSheetsAuthorization(u.p,u.p.sessionId,back,g.deps);
 await assert.rejects(finishSheetsAuthorization(u.p,u.p.sessionId,back,g.deps),{status:409});
 const conn=await sheets(u.p);assert.equal(conn.state,'setup');assert.equal(conn.config,null);
 // Expired attempt and a refused scope: no connection in that workspace.
 const w=await user();
 const late=new URL((await startSheetsAuthorization(w.p,w.p.sessionId)).authorizationUrl);
 await testAdmin(c=>c.query("UPDATE app.connector_oauth_attempt SET expires_at=now()-interval '1 second' WHERE workspace_id=$1",[w.p.workspaceId]));
 await assert.rejects(finishSheetsAuthorization(w.p,w.p.sessionId,new URL(callback+'?state='+late.searchParams.get('state')+'&code=c'),g.deps),{status:409});
 g.hooks.token=()=>Response.json({access_token:'x',token_type:'Bearer',expires_in:3600,scope:'openid',refresh_token:REFRESH});
 await assert.rejects(authorize(w.p,g),{status:422,code:'SHEETS_SCOPE_DENIED'});
 assert.equal(await testAdmin(async c=>Number((await c.query("SELECT count(*) FROM app.integration_connection WHERE workspace_id=$1 AND state<>'revoked'",[w.p.workspaceId])).rows[0].count)),0);
 const raw=await testAdmin(async c=>JSON.stringify((await c.query('SELECT * FROM app.integration_connection WHERE workspace_id=$1',[u.p.workspaceId])).rows));
 assert.doesNotMatch(raw+JSON.stringify(await listConnections(u.p)),/refresh-token-qa|access-token-qa/);
});

test('export appends one row per lead, updates the same row on later events and never duplicates it on retry',async()=>{
 const{p}=await user(),g=fakeGoogle();await authorize(p,g);
 const config=await configureSheets(p,setup(),g.deps);
 assert.deepEqual(g.only().rows,[['ID Cadence','Nome','E-mail','Qualificação','Último evento']]);assert.equal(g.only().title,'Leads');
 await seed(p,[lead('a1',{name:'=1+1'}),lead('a2')]);
 assert.deepEqual(await tick(p.workspaceId,g.deps),{exported:2,deferred:0});
 assert.deepEqual(g.only().rows.slice(1).map(r=>r[0]).sort(),['a1','a2']);
 assert.equal(g.only().rows.find(r=>r[0]==='a1')![1],'=1+1');
 await qualify(p.workspaceId,'a1');assert.equal((await tick(p.workspaceId,g.deps)).exported,1);
 assert.equal(g.only().rows.length,3);assert.deepEqual(g.only().rows.find(r=>r[0]==='a1')!.slice(3),['Qualificado','Lead qualificado']);
 // The append lands but its response is lost: the retry finds the row instead of adding another.
 await seed(p,[lead('a3')]);g.hooks.afterAppend=()=>{g.hooks.afterAppend=undefined;throw Error('socket hang up');};
 assert.deepEqual(await tick(p.workspaceId,g.deps),{exported:0,deferred:1});
 await dueNow(p.workspaceId);assert.equal((await tick(p.workspaceId,g.deps)).exported,1);
 assert.equal(g.only().rows.filter(r=>r[0]==='a3').length,1);
 assert.equal((await sheets(p)).config?.spreadsheetId,config.spreadsheetId);
});

test('a changed header holds the queue until restored; a refused refresh asks to reconnect and retrying cannot clear it',async()=>{
 const{p}=await user(),g=fakeGoogle();await authorize(p,g);await configureSheets(p,setup(),g.deps);
 g.only().rows[0][1]='Nome completo';await seed(p,[lead('b1'),lead('b2')]);
 assert.deepEqual(await tick(p.workspaceId,g.deps),{exported:0,deferred:1});
 let conn=await sheets(p);assert.equal(conn.attention,'schema');assert.match(conn.lastError!,/cabeçalho/);
 assert.deepEqual((await queue(p.workspaceId)).map(r=>r.state),['held','held']);
 await sheetsAction(p,conn.id,{action:'repair',expectedRevision:conn.configRevision},g.deps);
 assert.equal(g.only().rows[0][1],'Nome');assert.equal((await tick(p.workspaceId,g.deps)).exported,2);
 // An hour later the access token is expired and Google refuses the refresh token.
 g.hooks.token=p2=>p2.get('grant_type')==='refresh_token'?Response.json({error:'invalid_grant'},{status:400}):undefined;
 await qualify(p.workspaceId,'b1');const later={...g.deps,now:()=>Date.now()+2*3600e3};
 assert.deepEqual(await tick(p.workspaceId,later),{exported:0,deferred:1});
 conn=await sheets(p);assert.equal(conn.attention,'reconnect');
 await assert.rejects(sheetsAction(p,conn.id,{action:'retry',expectedRevision:conn.configRevision},g.deps),{status:409});
 // Reconnecting clears it and the held export goes out.
 g.hooks.token=undefined;await authorize(p,g);conn=await sheets(p);assert.equal(conn.attention,null);
 assert.equal((await tick(p.workspaceId,g.deps)).exported,1);
});

test('disconnecting or pausing while an export is in flight drops its result; a deleted sheet asks for a new one',async()=>{
 const{p}=await user(),g=fakeGoogle();await authorize(p,g);await configureSheets(p,setup(),g.deps);
 await seed(p,[lead('c1')]);
 g.hooks.beforeWrite=async()=>{g.hooks.beforeWrite=undefined;const c=await sheets(p);await sheetsAction(p,c.id,{action:'pause',expectedRevision:c.configRevision});};
 assert.deepEqual(await tick(p.workspaceId,g.deps),{exported:0,deferred:1});
 assert.deepEqual((await queue(p.workspaceId)).map(r=>r.state),['cancelled']);
 let conn=await sheets(p);await sheetsAction(p,conn.id,{action:'activate',expectedRevision:conn.configRevision});
 await qualify(p.workspaceId,'c1');
 g.hooks.beforeWrite=async()=>{g.hooks.beforeWrite=undefined;const c=await sheets(p);await disconnectIntegration(p,c.id,{expectedRevision:c.revision});};
 await tick(p.workspaceId,g.deps);
 assert.equal((await listConnections(p)).connections.some(c=>c.kind==='google-sheets'),false);assert.deepEqual(await queue(p.workspaceId),[]);
 // Paused leads stay out; a removed spreadsheet needs a new one.
 await authorize(p,g);conn=await sheets(p);assert.equal(conn.state,'setup');
 await configureSheets(p,setup({spreadsheetName:'[RE] Nova'}),g.deps);g.books.clear();await seed(p,[lead('c2')]);
 await tick(p.workspaceId,g.deps);assert.equal((await sheets(p)).attention,'missing');
});

test('connector HTTP: owner/admin only, OAuth and configuration never return tokens',async()=>{
 const u=await user(),v=await user(),mate={...v.p,workspaceId:u.p.workspaceId,role:'operator' as const};
 await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),mate.workspaceId,mate.userId,'operator']));
 await assert.rejects(startSheetsAuthorization(mate,mate.sessionId),{status:403});
 const r=await integrationsRequest(new Request(base+'/api/integrations',{method:'POST',headers:u.headers,body:JSON.stringify({action:'sheets-authorize'})}));
 assert.equal(r.status,200);const body=await r.json();assert.match(body.authorizationUrl,/^https:\/\/accounts\.google\.com\//);
 const conf=await integrationsRequest(new Request(base+'/api/integrations',{method:'POST',headers:u.headers,body:JSON.stringify({action:'sheets-configure',input:setup()})}));
 assert.equal(conf.status,404);
 assert.equal((await integrationItemRequest(new Request(base+'/api/integrations/x/sheets',{method:'POST',headers:u.headers,body:JSON.stringify({action:'drop',expectedRevision:1})}),'x','sheets')).status,422);
 delete process.env.GOOGLE_SHEETS_CLIENT_ID;
 try{assert.equal((await integrationsRequest(new Request(base+'/api/integrations',{method:'POST',headers:u.headers,body:JSON.stringify({action:'sheets-authorize'})}))).status,503);}
 finally{process.env.GOOGLE_SHEETS_CLIENT_ID=env.GOOGLE_SHEETS_CLIENT_ID;}
});

const connRow=(ws:string)=>testAdmin(async c=>(await c.query("SELECT token_expires_at,attention,last_success_at FROM app.integration_connection WHERE workspace_id=$1 AND kind='google-sheets' AND state<>'revoked'",[ws])).rows[0]);
const exportRowOf=(ws:string,id:string)=>testAdmin(async c=>(await c.query('SELECT state,event,first_at,next_at FROM app.sheet_export WHERE workspace_id=$1 AND lead_id=$2',[ws,id])).rows[0]);

test('review: a 401 with a live-looking token is refreshed once and retried; the worker saves the refreshed grant',async()=>{
 const{p}=await user(),g=fakeGoogle();await authorize(p,g);await configureSheets(p,setup(),g.deps);
 const before=(await connRow(p.workspaceId)).token_expires_at;
 let once=true;g.hooks.read=()=>{if(!once)return undefined;once=false;return Response.json({error:{code:401,status:'UNAUTHENTICATED'}},{status:401});};
 await seed(p,[lead('d1')]);g.hooks.tokens.length=0;
 assert.deepEqual(await tick(p.workspaceId,g.deps),{exported:1,deferred:0});
 assert.deepEqual(g.hooks.tokens,['refresh_token']);
 const after=await connRow(p.workspaceId);assert.equal(after.attention,null);assert.ok(after.token_expires_at>=before);
 // The saved grant decrypts: the next export uses it without another refresh.
 await qualify(p.workspaceId,'d1');assert.equal((await tick(p.workspaceId,g.deps)).exported,1);assert.deepEqual(g.hooks.tokens,['refresh_token']);
});

test('review: unreadable answers, quota and a disabled API are retried, never reported as a changed or lost sheet',async()=>{
 const{p}=await user(),g=fakeGoogle();await authorize(p,g);await configureSheets(p,setup(),g.deps);
 await seed(p,[lead('e1')]);
 for(const answer of[new Response('{truncated',{status:200}),Response.json({error:{status:'PERMISSION_DENIED',details:[{reason:'SERVICE_DISABLED'}]}},{status:403}),new Response('{}',{status:429,headers:{'retry-after':'600'}})]){
  g.hooks.read=()=>answer.clone();await dueNow(p.workspaceId);
  assert.deepEqual(await tick(p.workspaceId,g.deps),{exported:0,deferred:1});
  assert.equal((await connRow(p.workspaceId)).attention,null);assert.equal((await exportRowOf(p.workspaceId,'e1')).state,'pending');
 }
 assert.ok((await exportRowOf(p.workspaceId,'e1')).next_at.getTime()>Date.now()+500e3,'Retry-After is honoured');
 g.hooks.read=()=>Response.json({error:{status:'PERMISSION_DENIED',message:'The caller does not have permission'}},{status:403});await dueNow(p.workspaceId);
 await tick(p.workspaceId,g.deps);assert.equal((await connRow(p.workspaceId)).attention,'forbidden');
});

test('review: an event during an export runs it again with a fresh window; deleted leads are cancelled; replies export as lead.connected; a reconnect mid-export drops the stale result',async()=>{
 const{p}=await user(),g=fakeGoogle();await authorize(p,g);await configureSheets(p,setup(),g.deps);
 await seed(p,[lead('f1'),lead('f2')]);
 await testAdmin(c=>c.query("UPDATE app.sheet_export SET first_at=now()-interval '23 hours' WHERE workspace_id=$1",[p.workspaceId]));
 g.hooks.beforeWrite=async()=>{g.hooks.beforeWrite=undefined;await qualify(p.workspaceId,'f1');};
 await testAdmin(c=>c.query("UPDATE app.sheet_export SET next_at=now()+interval '1 hour' WHERE workspace_id=$1 AND lead_id='f2'",[p.workspaceId]));
 // The event that landed mid-export runs again in the same tick, with its own retry window, on the same row.
 assert.deepEqual(await tick(p.workspaceId,g.deps),{exported:2,deferred:0});
 const again=await exportRowOf(p.workspaceId,'f1');assert.equal(again.state,'done');assert.equal(again.event,'lead.qualified');assert.ok(again.first_at.getTime()>Date.now()-60e3);
 assert.deepEqual(g.only().rows.filter(r=>r[0]==='f1').map(r=>r[3]),['Qualificado']);
 // A reply arriving by e-mail is exported as lead.connected.
 await testAdmin(c=>c.query("SELECT app.emit_integration_event($1,'lead.connected','lead','f1','base','EMAIL','{}'::jsonb)",[p.workspaceId]));
 assert.equal((await tick(p.workspaceId,g.deps)).exported,1);assert.equal(g.only().rows.find(r=>r[0]==='f1')![4],'Lead respondeu (e-mail)');
 // A deleted lead is cancelled, not counted as an export.
 const success=(await connRow(p.workspaceId)).last_success_at;
 await testAdmin(c=>c.query("UPDATE app.sheet_export SET next_at=now() WHERE workspace_id=$1 AND lead_id='f2'",[p.workspaceId]));
 await testAdmin(c=>c.query("DELETE FROM app.lead WHERE workspace_id=$1 AND id='f2'",[p.workspaceId]));
 assert.deepEqual(await tick(p.workspaceId,g.deps),{exported:0,deferred:1});
 assert.equal((await exportRowOf(p.workspaceId,'f2')).state,'cancelled');assert.deepEqual((await connRow(p.workspaceId)).last_success_at,success);
 // An export started on the old grant whose result lands after a reconnect is dropped and runs again.
 await qualify(p.workspaceId,'f1');await testAdmin(c=>c.query(`UPDATE app.lead SET payload=jsonb_set(payload,'{name}','"[RE] Outro"') WHERE workspace_id=$1 AND id='f1'`,[p.workspaceId]));
 await testAdmin(c=>c.query("SELECT app.emit_integration_event($1,'lead.connected','lead','f1','base','WHATSAPP','{}'::jsonb)",[p.workspaceId]));
 g.hooks.beforeWrite=async()=>{g.hooks.beforeWrite=undefined;await authorize(p,g);};
 // Dropped once, then exported again on the new grant in the same tick.
 assert.deepEqual(await tick(p.workspaceId,g.deps),{exported:1,deferred:1});
 assert.equal((await exportRowOf(p.workspaceId,'f1')).state,'done');assert.equal((await connRow(p.workspaceId)).attention,null);
 assert.equal(g.only().rows.find(r=>r[0]==='f1')![4],'Lead respondeu (WhatsApp)');
});
