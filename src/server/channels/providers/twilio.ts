import {ChannelProviderError,type ProviderAdapter,type ProviderConfig} from './contracts.ts';
import {channelRequest,makeTemplate,requireOk,safeApiUrl,templateStatus} from './http.ts';
function config(c:ProviderConfig){if(c.provider!=='twilio'||!/^AC[a-fA-F0-9]{32}$/.test(c.identifiers.accountSid)||!/^\+[1-9]\d{6,14}$/.test(c.identifiers.sender)||!c.credentials.authToken||!['api-key','auth-token'].includes(c.identifiers.authMode))throw new ChannelProviderError('TWILIO_CONFIG_INVALID');}
function headers(c:ProviderConfig){
 const [user,password]=c.identifiers.authMode==='api-key'?[c.credentials.apiKeySid,c.credentials.apiKeySecret]:[c.identifiers.accountSid,c.credentials.authToken];
 if(!user||!password)throw new ChannelProviderError('TWILIO_CREDENTIAL_MISSING');return {authorization:'Basic '+Buffer.from(user+':'+password).toString('base64'),'content-type':'application/x-www-form-urlencoded'};
}
async function list(c:ProviderConfig,base:string,key:string,fetcher:typeof fetch){
 const output:any[]=[];let url=base;const allowed=new URL(base);
 for(let page=0;page<20;page++){
  const data=requireOk(await channelRequest(url,headers(c),{},fetcher));if(!Array.isArray(data[key]))throw new ChannelProviderError('TWILIO_CATALOG_INVALID');output.push(...data[key]);
  const next=data.meta?.next_page_url??data.next_page_uri;if(!next)return output;
  url=safeApiUrl(new URL(String(next),allowed.origin).toString(),allowed.hostname,allowed.pathname).toString();
 }
 throw new ChannelProviderError('TWILIO_CATALOG_INCOMPLETE');
}
export function createTwilioAdapter(fetcher:typeof fetch=fetch):ProviderAdapter{return {
 async verifyAssets(c){
  config(c);const account=c.identifiers.accountSid;
  const a=requireOk(await channelRequest('https://api.twilio.com/2010-04-01/Accounts/'+account+'.json',headers(c),{},fetcher));if(a.sid!==account||a.status!=='active')throw new ChannelProviderError('TWILIO_ACCOUNT_UNAVAILABLE');
  const rows=await list(c,'https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=100','senders',fetcher);
  const sender=rows.find(s=>s.sender_id==='whatsapp:'+c.identifiers.sender&&s.status==='ONLINE'&&(!s.account_sid||s.account_sid===account));
  if(!sender||!/^XE[a-fA-F0-9]{32}$/.test(sender.sid))throw new ChannelProviderError('TWILIO_SENDER_UNAVAILABLE');
  if(c.identifiers.messagingServiceSid){
   const base='https://messaging.twilio.com/v1/Services/'+c.identifiers.messagingServiceSid;
   const service=requireOk(await channelRequest(base,headers(c),{},fetcher));if(service.account_sid!==account)throw new ChannelProviderError('TWILIO_SERVICE_MISMATCH');
   const pool=await list(c,base+'/PhoneNumbers?PageSize=100','phone_numbers',fetcher);
   if(!pool.some(s=>s.phone_number===c.identifiers.sender&&s.account_sid===account))throw new ChannelProviderError('TWILIO_POOL_UNVERIFIED');
  }
  return {externalAccountId:account,senders:[{externalId:sender.sid,address:c.identifiers.sender,identityScope:'twilio:'+account,capabilities:{phoneOutbound:true,opaqueOutbound:false}}],tokenExpiresAt:null};
 },
 async listTemplates(c){
  config(c);const rows=await list(c,'https://content.twilio.com/v1/Content?PageSize=100','contents',fetcher),out=[];
  for(const row of rows){
   if(row.account_sid!==c.identifiers.accountSid||!/^HX[a-fA-F0-9]{32}$/.test(row.sid)||typeof row.language!=='string')throw new ChannelProviderError('TWILIO_TEMPLATE_MISMATCH');
   const approval=requireOk(await channelRequest('https://content.twilio.com/v1/Content/'+row.sid+'/ApprovalRequests',headers(c),{},fetcher));
   if(approval.account_sid!==c.identifiers.accountSid)throw new ChannelProviderError('TWILIO_TEMPLATE_MISMATCH');
   const text=row.types?.['twilio/text']?.body,unsupported=typeof text!=='string';
   const parameters=unsupported?[{component:'body' as const,key:'unsupported',type:'media' as const}]:[...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m=>({component:'body' as const,key:'body.'+m[1],type:'text' as const}));
   out.push(makeTemplate({connectionId:c.connectionId,provider:'twilio',remoteId:row.sid,name:approval.whatsapp?.name??row.friendly_name??row.sid,language:row.language,status:templateStatus(approval.whatsapp?.status),parameters:[...new Map(parameters.map(p=>[p.key,p])).values()],components:[{type:'body',text:unsupported?'Conteúdo não suportado neste piloto':text}]}));
  }
  return out;
 },
 async sendOnce(c,send,callbackUrl){
  try{
   config(c);if(!c.sender||send.connectionId!==c.connectionId||send.connectionRevision!==c.revision||send.senderId!==c.sender.id||c.sender.address!==c.identifiers.sender||!send.identity.phone)throw new ChannelProviderError('TWILIO_SEND_INVALID');
   const callback=new URL(callbackUrl);if(callback.protocol!=='https:'||callback.username||callback.password)throw new ChannelProviderError('TWILIO_CALLBACK_INVALID');
   const body=new URLSearchParams({From:'whatsapp:'+c.identifiers.sender,To:'whatsapp:'+send.identity.phone,StatusCallback:callbackUrl});if(c.identifiers.messagingServiceSid)body.set('MessagingServiceSid',c.identifiers.messagingServiceSid);
   const content=send.content;
   if(content.kind==='text')body.set('Body',content.text);else{
    const t=c.templates.find(t=>t.id===content.templateId&&t.revision===content.templateRevision&&t.provider==='twilio'&&t.connectionId===c.connectionId&&t.status==='approved');if(!t||t.parameters.some(p=>p.type!=='text'))throw new ChannelProviderError('TWILIO_TEMPLATE_UNAVAILABLE');
    body.set('ContentSid',t.remoteId);body.set('ContentVariables',JSON.stringify(Object.fromEntries(t.parameters.map(p=>[p.key.replace(/^body\./,''),content.variables[p.key]]))));
   }
   const r=await channelRequest('https://api.twilio.com/2010-04-01/Accounts/'+c.identifiers.accountSid+'/Messages.json',headers(c),{method:'POST',body:body.toString()},fetcher);
   if(r.ok&&r.data.account_sid===c.identifiers.accountSid&&/^SM[a-fA-F0-9]{32}$/.test(r.data.sid))return {kind:'accepted',remoteId:r.data.sid,acceptedAt:new Date().toISOString()};
   if(r.status>=400&&r.status<500&&typeof r.data.code==='number')return {kind:'not_accepted',code:'TWILIO_'+r.data.code,retryable:r.status===429,retryAfterMs:r.retryAfterMs};
   return {kind:'uncertain',code:'TWILIO_RESPONSE_UNCERTAIN'};
  }catch(e){return e instanceof ChannelProviderError&&['TWILIO_CONFIG_INVALID','TWILIO_CREDENTIAL_MISSING','TWILIO_SEND_INVALID','TWILIO_TEMPLATE_UNAVAILABLE','TWILIO_CALLBACK_INVALID'].includes(e.code)?{kind:'not_accepted',code:e.code,retryable:false,retryAfterMs:null}:{kind:'uncertain',code:'TWILIO_RESPONSE_UNCERTAIN'};}
 },
 async lookupMessage(c,remoteId){
  config(c);if(!/^SM[a-fA-F0-9]{32}$/.test(remoteId))throw new ChannelProviderError('TWILIO_MESSAGE_INVALID');
  const r=requireOk(await channelRequest('https://api.twilio.com/2010-04-01/Accounts/'+c.identifiers.accountSid+'/Messages/'+remoteId+'.json',headers(c),{},fetcher));
  if(r.sid!==remoteId||r.account_sid!==c.identifiers.accountSid)throw new ChannelProviderError('TWILIO_MESSAGE_MISMATCH');
  if(typeof r.from!=='string'||typeof r.to!=='string')throw new ChannelProviderError('TWILIO_MESSAGE_EVIDENCE_INCOMPLETE');
  return {kind:'accepted',remoteId,acceptedAt:new Date(r.date_created).toISOString(),evidence:{accountId:r.account_sid,from:r.from,to:r.to}};
 },
};}
