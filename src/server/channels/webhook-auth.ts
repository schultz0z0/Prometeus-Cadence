import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import type {AuthenticatedBatch} from '../../domain/whatsapp.ts';
import {AppError} from '../errors.ts';
import {readBoundedBody} from './providers/http.ts';
import type {IngressContext} from './ingress-contracts.ts';
import {normalizeMetaEvents} from './webhook-events.ts';
interface AuthDeps {lookup?:(publicId:string)=>Promise<IngressContext|null>;now?:()=>string;markChallenge?:(id:string,revision:number)=>Promise<void>}
async function lookup(publicId:string,deps:AuthDeps){
 const ctx=await (deps.lookup??(await import('./ingress-db.ts')).lookupIngress)(publicId);if(!ctx)throw new AppError(404,'Conexão não encontrada.');return ctx;
}
export function channelCallbackUrl(provider:'meta'|'twilio',publicId:string,kind='messages'){
 if(provider!=='meta')throw new AppError(410,'Twilio foi aposentado.','PROVIDER_RETIRED');
 const raw=process.env.CHANNEL_PUBLIC_BASE_URL;if(!raw)throw new AppError(409,'Configure o endereço HTTPS público dos callbacks.');
 const base=new URL(raw);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw new AppError(409,'Endereço público de callbacks inválido.');
 return base.origin+'/api/channel-webhooks/'+provider+'/'+encodeURIComponent(publicId) ;
}
export async function verifyMetaChallenge(request:Request,publicId:string,deps:AuthDeps={}):Promise<string>{
 const ctx=await lookup(publicId,deps),url=new URL(request.url),token=url.searchParams.get('hub.verify_token'),challenge=url.searchParams.get('hub.challenge');
 const current=ctx.credentialVersions.find(v=>v.revision===ctx.revision);
 if(ctx.provider!=='meta'||ctx.state==='disconnected'||url.searchParams.get('hub.mode')!=='subscribe'||!token||!challenge||challenge.length>1024||!current?.credentials.verifyToken||!safeEqual(token,current.credentials.verifyToken))throw new AppError(403,'Verificação do callback recusada.');
 await (deps.markChallenge??(await import('./ingress-db.ts')).markChallenge)(ctx.id,ctx.revision);return challenge;
}
function safeEqual(a:string,b:string){const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
export async function authenticateWebhook(request:Request,publicId:string,kind:'meta'|'twilio-messages'|'twilio-status',deps:AuthDeps={}):Promise<AuthenticatedBatch>{
 if(kind!=='meta')throw new AppError(410,'Twilio foi aposentado.','PROVIDER_RETIRED');
 if(Number(request.headers.get('content-length'))>1048576)throw new AppError(413,'Callback limitado a 1 MiB.');
 let bytes:Uint8Array;try{bytes=await readBoundedBody(new Response(request.body),1048576);}catch{throw new AppError(413,'Callback limitado a 1 MiB.');}
 const ctx=await lookup(publicId,deps);if(ctx.provider!=='meta')throw new AppError(403,'Provedor divergente.');
 let revision:number|undefined,effective=ctx,parsed:any;
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new AppError(415,'Tipo de callback inválido.');
  const signature=request.headers.get('x-hub-signature-256')??'';if(!/^sha256=[a-fA-F0-9]{64}$/.test(signature))throw new AppError(403,'Assinatura inválida.');
  for(const version of ctx.credentialVersions){
   if(!version.credentials.appSecret||version.externalAccountId===null)continue;const expected='sha256='+createHmac('sha256',version.credentials.appSecret).update(bytes).digest('hex');
   if(safeEqual(expected,signature.toLowerCase())){revision=version.revision;effective={...ctx,identifiers:version.identifiers??ctx.identifiers,externalAccountId:version.externalAccountId===undefined?ctx.externalAccountId:version.externalAccountId};break;}
  }
  if(revision===undefined)throw new AppError(403,'Assinatura inválida.');
  try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError(422,'Callback JSON inválido.');}
 if(!effective.externalAccountId)throw new AppError(403,'Os ativos desta conexão ainda não foram verificados.');
 const events=normalizeMetaEvents(parsed,effective);
 return {connectionId:ctx.id,credentialRevision:revision!,bodyHash:createHash('sha256').update(bytes).digest('hex'),receivedAt:deps.now?.()??new Date().toISOString(),events};
}
