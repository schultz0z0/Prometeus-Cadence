import {AppError} from '../errors.ts';
import {oauthStore,createOAuthStore} from './store.ts';
import {oauthToken} from './protocol.ts';
export function localOAuthRedirect(){
 try{const url=new URL(process.env.BETTER_AUTH_URL??'');if(process.env.CADENCE_RUNTIME_MODE!=='local'||url.protocol!=='http:'||url.hostname!=='127.0.0.1')return null;return new URL('/api/ai-oauth/chatgpt/callback',url).href;}catch{return null;}
}
export function requireLocalOAuth(){const uri=localOAuthRedirect();if(!uri)throw new AppError(409,'O ChatGPT OAuth direto está habilitado somente na instalação local. A oferta hospedada exige registro próprio na OpenAI.','CHATGPT_LOCAL_ONLY');return uri;}
export async function oauthAccessToken(workspaceId:string,expectedRevision:number,deps:{store?:ReturnType<typeof createOAuthStore>;fetcher?:typeof fetch}={}){
 requireLocalOAuth();const store=deps.store??oauthStore;return store.lock(workspaceId,async()=>{
  const row=store.read(workspaceId);if(!row||row.state!=='connected'||row.revision!==expectedRevision)throw new AppError(409,'A conexão ChatGPT mudou.','AI_CONFIGURATION_CHANGED');const secrets=store.credentials(workspaceId,row.revision);
  if(row.refreshPending){store.save(workspaceId,{...row,state:'attention',revision:row.revision+1,lastError:'CHATGPT_RECONNECT_REQUIRED'},{});throw new AppError(409,'Uma renovação foi interrompida. Reconecte o ChatGPT.','CHATGPT_RECONNECT_REQUIRED');}
  if(row.expiresAt>Date.now()+60000&&secrets.accessToken)return secrets.accessToken;
  try{
   if(!row.clientId||!secrets.refreshToken)throw Error('missing');
   // Persist intent before rotating. A crashed or uncertain refresh must not
   // retry the old rotating token when another process recovers the lock.
   store.save(workspaceId,{...row,refreshPending:true},secrets);
   const tokens=await oauthToken({grant_type:'refresh_token',client_id:row.clientId,refresh_token:secrets.refreshToken},deps.fetcher);
   const scopes=tokens.scope?tokens.scope.split(/\s+/):row.scopes;
   if(!['resource.invoke','chatgpt.tokens.use.direct','offline_access'].every(s=>scopes.includes(s)))throw Error('scope');
   // Keep the verified identity hint. A refresh response is not a new login.
   if(store.read(workspaceId)?.revision!==expectedRevision)throw new AppError(409,'A conexão ChatGPT mudou.','AI_CONFIGURATION_CHANGED');
   store.save(workspaceId,{...row,refreshPending:false,scopes,expiresAt:Date.now()+tokens.expires_in*1000},{...secrets,accessToken:tokens.access_token,refreshToken:tokens.refresh_token??secrets.refreshToken});return tokens.access_token;
  }catch{
   if(store.read(workspaceId)?.revision===expectedRevision)store.save(workspaceId,{...row,state:'attention',revision:row.revision+1,lastError:'CHATGPT_RECONNECT_REQUIRED'},{});
   throw new AppError(409,'Reconecte sua conta ChatGPT.','CHATGPT_RECONNECT_REQUIRED');
  }
 });
}
