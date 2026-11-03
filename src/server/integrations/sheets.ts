import 'server-only';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {sheetActionSchema,sheetHeaders,sheetRow,sheetSetupSchema,type SheetAttention,type SheetConfig,type SheetEvent} from '../../domain/connector-capabilities.ts';
import {nextRetryDelay} from '../../domain/integration-delivery.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import type {EncryptedCredential} from '../channels/crypto.ts';
import {workerPool} from '../prospecting/worker-db.ts';
import {connectorError} from './connections.ts';
import {GoogleAttention,GoogleRetry,finishGoogleAuthorization,google as googleCall,googleCallbackHttp,googleOAuthSettings,openTokens,sealTokens,startGoogleAuthorization,withAccess,type GoogleDeps,type Tokens} from './google.ts';
export {SHEETS_SCOPE,GoogleAttention as SheetsAttention} from './google.ts';
const API='https://sheets.googleapis.com/v4/spreadsheets';
export type SheetsDeps=GoogleDeps;
const KIND='google-sheets';
export const sheetsOAuthSettings=(env?:Record<string,string|undefined>)=>googleOAuthSettings(KIND,env);
const attentionText={
 schema:'Os cabeçalhos da planilha foram alterados. Restaure o cabeçalho para continuar.',
 missing:'A planilha ou a aba não existe mais. Crie uma planilha nova.',
 forbidden:'A conta Google perdeu acesso a esta planilha. Reconecte ou crie uma planilha nova.',
};
const google=(method:'GET'|'POST'|'PUT',url:string,token:string,body:unknown,deps:SheetsDeps)=>googleCall(method,url,token,body,deps,attentionText);
const range=(title:string,a1:string)=>encodeURIComponent(`'${title.replace(/'/g,"''")}'!${a1}`);
export async function createSpreadsheet(token:string,input:{spreadsheetName:string;sheetTitle:string;headers:string[]},deps:SheetsDeps):Promise<string>{
 const data=await google('POST',API,token,{properties:{title:input.spreadsheetName},sheets:[{properties:{title:input.sheetTitle,gridProperties:{frozenRowCount:1}},
  data:[{startRow:0,startColumn:0,rowData:[{values:input.headers.map(h=>({userEnteredValue:{stringValue:h}}))}]}]}]},deps);
 if(typeof data?.spreadsheetId!=='string'||!/^[A-Za-z0-9_-]{10,200}$/.test(data.spreadsheetId))throw new GoogleRetry('O Google não devolveu a planilha criada.');
 return data.spreadsheetId;
}
const writeHeader=(token:string,c:SheetConfig,deps:SheetsDeps)=>google('PUT',`${API}/${c.spreadsheetId}/values/${range(c.sheetTitle,'A1')}?valueInputOption=RAW`,token,{values:[sheetHeaders(c.columns)]},deps);
// Upsert by the technical id in column A: a retry after a lost response finds the row instead of appending a second one.
export async function exportRow(token:string,c:SheetConfig,row:string[],deps:SheetsDeps):Promise<void>{
 if(!row[0])throw Error('Lead id missing');
 const got=await google('GET',`${API}/${c.spreadsheetId}/values:batchGet?ranges=${range(c.sheetTitle,'1:1')}&ranges=${range(c.sheetTitle,'A:A')}&majorDimension=ROWS`,token,undefined,deps);
 const header:string[]=got?.valueRanges?.[0]?.values?.[0]??[],ids:string[][]=got?.valueRanges?.[1]?.values??[],expected=sheetHeaders(c.columns);
 if(expected.some((h,i)=>header[i]!==h))throw new GoogleAttention('schema',attentionText.schema);
 // shortcut: reads all of column A per export; fine for tens of thousands of rows, cache the row number if sheets grow past that.
 const at=ids.findIndex((r,i)=>i>0&&r[0]===row[0]);
 if(at>0)await google('PUT',`${API}/${c.spreadsheetId}/values/${range(c.sheetTitle,'A'+(at+1))}?valueInputOption=RAW`,token,{values:[row]},deps);
 else await google('POST',`${API}/${c.spreadsheetId}/values/${range(c.sheetTitle,'A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,token,{values:[row]},deps);
}

// --- OAuth (owner/admin, same session start to finish) ---
export const startSheetsAuthorization=(p:Principal,sessionId:string)=>startGoogleAuthorization(KIND,p,sessionId);
export const finishSheetsAuthorization=(p:Principal,sessionId:string,url:URL,deps:SheetsDeps={})=>finishGoogleAuthorization(KIND,p,sessionId,url,deps);
export const sheetsCallbackHttp=(request:Request,deps:SheetsDeps={})=>googleCallbackHttp(KIND,request,deps);

// --- Admin actions that need the customer's tokens for this request only ---
async function liveSheets(c:PoolClient,id?:string){
 const r=(await c.query("SELECT id,revision,config,config_revision,state FROM app.integration_connection WHERE kind='google-sheets' AND state<>'revoked'"+(id?' AND id=$1':''),id?[id]:[])).rows[0];
 if(!r)throw new AppError(404,'Conecte a conta Google primeiro.','CONNECTION_NOT_FOUND');
 return{id:r.id as string,revision:Number(r.revision),config:r.config as SheetConfig|null,configRevision:Number(r.config_revision)};
}
async function asAdmin<T>(p:Principal,live:{id:string;revision:number},fn:(token:string)=>Promise<T>,deps:SheetsDeps):Promise<T>{
 const sealed=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT app.sheets_admin_secret($1,$2) v',[live.id,live.revision])).rows[0].v as EncryptedCredential);
 const tokens=openTokens(KIND,sealed,p.workspaceId,live.id,live.revision);
 return withAccess(KIND,tokens,t=>withWorkspaceTransaction(p,c=>c.query('SELECT app.save_sheets_tokens($1,$2,$3,$4)',[live.id,live.revision,sealTokens(KIND,t,p.workspaceId,live.id,live.revision),t.expiresAt])),fn,deps);
}
const googleError=(e:unknown)=>e instanceof GoogleAttention?new AppError(e.attention==='reconnect'?409:422,e.message,'SHEETS_'+e.attention.toUpperCase()):e instanceof GoogleRetry?new AppError(503,e.message+' Tente de novo em instantes.','SHEETS_UNAVAILABLE'):e;
export async function configureSheets(p:Principal,raw:unknown,deps:SheetsDeps={}){
 const parsed=sheetSetupSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Revise o nome da planilha, a aba, as colunas e os gatilhos.');const input=parsed.data;
 try{
  const live=await withWorkspaceTransaction(p,async c=>{await c.query('SELECT app.connector_actor()');return liveSheets(c);});
  if(live.configRevision!==input.expectedRevision)throw new AppError(409,'A conexão mudou em outra aba. Recarregue antes de continuar.','CONNECTION_CONFLICT');
  // shortcut: a spreadsheet created right before a conflicting save is left in the customer's Drive; it is empty apart from the header.
  const spreadsheetId=await asAdmin(p,live,token=>createSpreadsheet(token,{spreadsheetName:input.spreadsheetName,sheetTitle:input.sheetTitle,headers:sheetHeaders(input.columns)},deps),deps);
  const config:SheetConfig={spreadsheetId,spreadsheetName:input.spreadsheetName,sheetTitle:input.sheetTitle,columns:input.columns,events:input.events};
  await withWorkspaceTransaction(p,c=>c.query('SELECT app.configure_sheets($1,$2,$3,$4)',[live.id,live.revision,input.expectedRevision,config]));
  return config;
 }catch(e){throw connectorError(googleError(e));}
}
export async function sheetsAction(p:Principal,id:string,raw:unknown,deps:SheetsDeps={}){
 const parsed=sheetActionSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Operação inválida.');
 try{
  if(parsed.data.action==='repair'){
   const live=await withWorkspaceTransaction(p,async c=>{await c.query('SELECT app.connector_actor()');return liveSheets(c,id);});
   if(!live.config||live.configRevision!==parsed.data.expectedRevision)throw new AppError(409,'A conexão mudou em outra aba. Recarregue antes de continuar.','CONNECTION_CONFLICT');
   const config=live.config;await asAdmin(p,live,token=>writeHeader(token,config,deps),deps);
  }
  const configRevision=await withWorkspaceTransaction(p,async c=>Number((await c.query('SELECT app.sheets_action($1,$2,$3) v',[id,parsed.data.expectedRevision,parsed.data.action])).rows[0].v));
  return{configRevision};
 }catch(e){throw connectorError(googleError(e));}
}

// --- Worker ---
type Claimed={workspace_id:string;connection_id:string;lead_id:string;attempts:number;first_at:Date;event:SheetEvent;channel:string|null;revision:string;config_revision:string;
 secret:EncryptedCredential;config:SheetConfig;token_expires_at:Date|null;lead:Record<string,unknown>|null;list_name:string|null};
export async function dispatchSheetsTick(input:{limit:number;signal:AbortSignal},deps:SheetsDeps={}):Promise<{exported:number;deferred:number}>{
 if(!Number.isInteger(input.limit)||input.limit<1||input.limit>100)throw Error('Invalid sheets batch');
 const token=randomUUID(),c=await workerPool().connect(),now=deps.now??Date.now,stopAt=Date.now()+20000;let exported=0,deferred=0;
 try{
  // Bounded per tick so slow Google answers do not hold the lane past its next interval.
  for(let i=0;i<input.limit&&!input.signal.aborted&&Date.now()<stopAt;i++){
   const row=(await c.query('SELECT * FROM app.claim_sheet_export($1)',[token])).rows[0] as Claimed|undefined;if(!row)break;
   const revision=Number(row.revision);
   let state:'done'|'pending'|'failed'|'held'|'cancelled'=row.lead?'done':'cancelled',error:string|null=null,next:Date|null=null,attention:SheetAttention|null=null;
   try{
    // A deleted lead has nothing left to export.
    if(row.lead){
     const tokens=openTokens(KIND,row.secret,row.workspace_id,row.connection_id,revision);
     const save=(t:Tokens)=>c.query('SELECT app.worker_save_sheets_tokens($1,$2,$3,$4,$5,$6,$7)',[row.workspace_id,row.connection_id,revision,sealTokens(KIND,t,row.workspace_id,row.connection_id,revision),t.expiresAt,row.lead_id,token]);
     // Column A comes from the queue row, never from the payload, so a malformed payload cannot match another lead's row.
     const values=sheetRow({...row.lead,id:row.lead_id},row.config.columns,{list:row.list_name,event:row.event,channel:row.channel,exportedAt:new Date(now()).toISOString()});
     await withAccess(KIND,tokens,save,access=>exportRow(access,row.config,values,deps),deps);
    }
   }catch(e){
    if(e instanceof GoogleAttention){state='held';error=e.message;attention=e.attention;}
    else{
     const label=e instanceof GoogleRetry?e.message:'Falha inesperada ao exportar.',delay=nextRetryDelay({attempt:row.attempts,ageMs:now()-row.first_at.getTime(),retryAfterMs:e instanceof GoogleRetry?e.retryAfterMs:undefined});
     if(delay===null){state='failed';error=label+' Prazo de 24 h esgotado.';}else{state='pending';error=label;next=new Date(now()+delay);}
    }
   }
   const applied=(await c.query('SELECT app.finish_sheet_export($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) v',[row.workspace_id,row.connection_id,row.lead_id,token,revision,Number(row.config_revision),state,error,next,attention])).rows[0].v;
   if(state==='done'&&applied)exported++;else deferred++;
  }
 }finally{c.release();}
 return{exported,deferred};
}
