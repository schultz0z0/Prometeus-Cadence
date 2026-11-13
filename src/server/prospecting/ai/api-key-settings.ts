import 'server-only';
import {z} from 'zod';
import type {Principal} from '../../../domain/workspace.ts';
import type {ApiKeyProvider,ApiKeyView} from '../../../domain/ai-routing.ts';
import {withWorkspaceTransaction} from '../../db/transaction.ts';
import {AppError} from '../../errors.ts';
import {providerJson,ProviderError} from '../providers/transport.ts';
import type {Fetch} from '../providers/types.ts';
import {requireAiAdmin} from './settings.ts';
import {platformAiWorkspace} from './platform.ts';
import {apiKeyView,storedApiKey,writeApiKey} from './api-keys.ts';
const model=z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/);
const schema=z.strictObject({provider:z.enum(['openai','gemini']),expectedRevision:z.number().int().nonnegative(),key:z.string().trim().min(10).max(400).regex(/^[\x21-\x7e]+$/).optional(),model:model.optional(),remove:z.literal(true).optional()});
/** Text models the key can call; listing them is also the proof the provider accepts the key. */
export async function listProviderModels(provider:ApiKeyProvider,key:string,fetcher:Fetch=fetch):Promise<string[]>{
 const signal=AbortSignal.timeout(20000);let ids:string[];
 try{
  if(provider==='gemini'){const raw:any=await providerJson(fetcher,'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',{headers:{'x-goog-api-key':key}},signal);
   ids=(raw?.models??[]).filter((m:any)=>Array.isArray(m?.supportedGenerationMethods)&&m.supportedGenerationMethods.includes('generateContent')).map((m:any)=>String(m.name??'').replace(/^models\//,'')).filter((id:string)=>/^gemini/.test(id));}
  else{const raw:any=await providerJson(fetcher,'https://api.openai.com/v1/models',{headers:{authorization:'Bearer '+key}},signal);
   ids=(raw?.data??[]).map((m:any)=>String(m?.id??'')).filter((id:string)=>/^(gpt-|o\d|chatgpt-)/.test(id)&&!/audio|realtime|tts|transcribe|image|search|instruct/.test(id));}
 }catch(error){
  if(error instanceof ProviderError&&[400,401,403].includes(error.status))throw new AppError(422,'O provedor recusou a chave. Confira a chave e tente de novo.','AI_KEY_REJECTED');
  throw new AppError(502,'Não foi possível consultar o provedor agora. Tente de novo em instantes.','AI_KEY_UNVERIFIED');
 }
 return [...new Set(ids.filter(id=>model.safeParse(id).success))].sort();
}
export async function saveApiKey(p:Principal,input:unknown,fetcher:Fetch=fetch):Promise<ApiKeyView|null>{
 const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError(422,'Revise a chave e o modelo.');const b=parsed.data,scope=platformAiWorkspace();
 if(!scope)throw new AppError(409,'A IA da plataforma não está configurada neste servidor.');
 await withWorkspaceTransaction(p,requireAiAdmin);
 let next:{key:string;model:string;models:string[]}|null=null;
 if(!b.remove){
  const current=storedApiKey(scope,b.provider),key=b.key??current?.key;if(!key)throw new AppError(422,'Informe a chave da API.');
  const models=b.key?await listProviderModels(b.provider,key,fetcher):apiKeyView(scope,b.provider)?.models??[];
  if(!models.length)throw new AppError(422,'A chave não tem acesso a nenhum modelo de texto.','AI_KEY_NO_MODELS');
  const chosen=b.model??current?.model??'';if(b.model&&!models.includes(b.model))throw new AppError(422,'Modelo indisponível para esta chave.');
  next={key,model:models.includes(chosen)?chosen:'',models};
 }
 return withWorkspaceTransaction(p,async c=>{
  await requireAiAdmin(c);let view;
  try{view=writeApiKey(scope,b.provider,b.expectedRevision,next);}catch(error){if((error as Error).message==='AI_KEY_CHANGED')throw new AppError(409,'A chave mudou em outra aba. Recarregue antes de salvar.','AI_KEY_CHANGED');throw error;}
  await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES(current_setting('app.workspace_id'),$1,$2)",[p.userId,(next?'ai.key.save.':'ai.key.remove.')+b.provider]);
  return view;
 });
}
