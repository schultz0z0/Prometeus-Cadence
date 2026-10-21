import type {PreparedSend,SendOutcome,TemplateComponent,TemplateParameter} from '../../../domain/whatsapp.ts';
import {ChannelProviderError,type ProviderAdapter,type ProviderConfig} from './contracts.ts';
import {channelRequest,makeTemplate,requireOk,safeApiUrl,templateStatus} from './http.ts';
const origin='https://graph.facebook.com/v26.0';
function headers(c:ProviderConfig){return {authorization:'Bearer '+c.credentials.accessToken,'content-type':'application/json'};}
async function list(c:ProviderConfig,path:string,fetcher:typeof fetch){
 const output:any[]=[];let after:string|undefined;
 for(let page=0;page<20;page++){
  const u=new URL(origin+path);u.searchParams.set('limit','100');if(after)u.searchParams.set('after',after);
  const data=requireOk(await channelRequest(u.toString(),headers(c),{},fetcher));if(!Array.isArray(data.data))throw new ChannelProviderError('CATALOG_INVALID');output.push(...data.data);
  if(!data.paging?.next)return output;
  safeApiUrl(String(data.paging.next),'graph.facebook.com',u.pathname);const next=data.paging?.cursors?.after;
  if(typeof next!=='string'||!next||next===after)throw new ChannelProviderError('CATALOG_INCOMPLETE');after=next;
 }
 throw new ChannelProviderError('CATALOG_INCOMPLETE');
}
function config(c:ProviderConfig){if(c.provider!=='meta'||!/^\d+$/.test(c.identifiers.appId)||!/^\d+$/.test(c.identifiers.wabaId)||!/^\d+$/.test(c.identifiers.phoneNumberId)||!c.credentials.accessToken||!c.credentials.appSecret)throw new ChannelProviderError('META_CONFIG_INVALID');}
export function createMetaAdapter(fetcher:typeof fetch=fetch):ProviderAdapter{return {
 async verifyAssets(c){
  config(c);const debug=new URL(origin+'/debug_token');debug.searchParams.set('input_token',c.credentials.accessToken);
  const inspection=requireOk(await channelRequest(debug.toString(),{authorization:'Bearer '+c.identifiers.appId+'|'+c.credentials.appSecret},{},fetcher)).data;
  if(!inspection?.is_valid||String(inspection.app_id)!==c.identifiers.appId||!['whatsapp_business_management','whatsapp_business_messaging'].every(s=>inspection.scopes?.includes(s)))throw new ChannelProviderError('META_TOKEN_SCOPE_INVALID');
  const account=requireOk(await channelRequest(origin+'/'+c.identifiers.wabaId,headers(c),{},fetcher));if(String(account.id)!==c.identifiers.wabaId)throw new ChannelProviderError('META_WABA_MISMATCH');
  const numbers=await list(c,'/'+c.identifiers.wabaId+'/phone_numbers',fetcher),number=numbers.find(n=>String(n.id)===c.identifiers.phoneNumberId);
  if(!number||number.code_verification_status!=='VERIFIED')throw new ChannelProviderError('META_SENDER_UNAVAILABLE');
  const phone='+'+String(number.display_phone_number??'').replace(/\D/g,'');if(!/^\+[1-9]\d{6,14}$/.test(phone))throw new ChannelProviderError('META_SENDER_INVALID');
  const expires=Number(inspection.expires_at);if(expires>0&&expires*1000<=Date.now())throw new ChannelProviderError('META_TOKEN_EXPIRED');
  return {externalAccountId:c.identifiers.wabaId,senders:[{externalId:String(number.id),address:phone,identityScope:'meta:'+c.identifiers.wabaId,capabilities:{phoneOutbound:true,opaqueOutbound:false}}],tokenExpiresAt:expires>0?new Date(expires*1000).toISOString():null};
 },
 async listTemplates(c){
  config(c);const rows=await list(c,'/'+c.identifiers.wabaId+'/message_templates',fetcher);
  return rows.map(row=>{
   if(!/^\d+$/.test(String(row.id))||typeof row.name!=='string'||typeof row.language!=='string'||!Array.isArray(row.components))throw new ChannelProviderError('META_TEMPLATE_INVALID');
   const parameters:TemplateParameter[]=[],components:TemplateComponent[]=[];
   for(const raw of row.components){
    const type=String(raw.type).toLowerCase();
    if(type==='header'||type==='body'||type==='footer'){
     const text=String(raw.text??'');components.push({type,text});
     if(type==='header'&&raw.format&&raw.format!=='TEXT')parameters.push({component:'header',key:'header.media',type:'media'});
     for(const m of text.matchAll(/\{\{\s*([\w]+)\s*\}\}/g))if(!parameters.some(p=>p.key===type+'.'+m[1]))parameters.push({component:type==='footer'?'body':type,key:type+'.'+m[1],type:'text'});
    }else if(type==='buttons'){
     for(const [index,button]of (raw.buttons??[]).entries()){
      components.push({type:'button',text:String(button.text??''),buttonIndex:index});
      // Dynamic and non-URL actions are catalogued but are not dispatchable in the text-only pilot.
      if(button.type!=='URL'||/\{\{/.test(String(button.url??'')))parameters.push({component:'button',key:'button.'+index,type:'media',buttonIndex:index});
     }
    }else parameters.push({component:'body',key:'unsupported.'+type,type:'media'});
   }
   return makeTemplate({connectionId:c.connectionId,provider:'meta',remoteId:String(row.id),name:row.name,language:row.language,status:templateStatus(row.status),parameters,components});
  });
 },
 async sendOnce(c,send){
  try{
   config(c);if(!c.sender||c.sender.id!==send.senderId||send.connectionId!==c.connectionId||send.connectionRevision!==c.revision||c.sender.externalId!==c.identifiers.phoneNumberId||!send.identity.phone)throw new ChannelProviderError('META_SEND_INVALID');
   const content=send.content;let payload:Record<string,unknown>={messaging_product:'whatsapp',to:send.identity.phone.replace(/^\+/,''),type:'text',text:{body:content.kind==='text'?content.text:'',preview_url:false}};
   if(content.kind==='template'){
    const t=c.templates.find(t=>t.id===content.templateId&&t.revision===content.templateRevision&&t.provider==='meta'&&t.connectionId===c.connectionId&&t.status==='approved');if(!t||t.parameters.some(p=>p.type!=='text'))throw new ChannelProviderError('META_TEMPLATE_UNAVAILABLE');
    const components=['header','body'].flatMap(type=>{
     const params=t.parameters.filter(p=>p.component===type);
     return params.length?[{type,parameters:params.map(p=>{
      const name=p.key.split('.').at(-1)!;
      return {type:'text',text:content.variables[p.key],...(/^\d+$/.test(name)?{}:{parameter_name:name})};
     })}]:[];
    });
    payload={messaging_product:'whatsapp',to:send.identity.phone.replace(/^\+/,''),type:'template',template:{name:t.name,language:{code:t.language},...(components.length?{components}:{})}};
   }
   const r=await channelRequest(origin+'/'+c.identifiers.phoneNumberId+'/messages',headers(c),{method:'POST',body:JSON.stringify(payload)},fetcher);
   if(r.ok&&typeof r.data?.messages?.[0]?.id==='string')return {kind:'accepted',remoteId:r.data.messages[0].id,acceptedAt:new Date().toISOString()};
   if(r.status>=400&&r.status<500&&typeof r.data?.error?.code==='number')return {kind:'not_accepted',code:'META_'+r.data.error.code,retryable:r.status===429,retryAfterMs:r.retryAfterMs};
   return {kind:'uncertain',code:'META_RESPONSE_UNCERTAIN'};
  }catch(e){return e instanceof ChannelProviderError&&['META_CONFIG_INVALID','META_SEND_INVALID','META_TEMPLATE_UNAVAILABLE'].includes(e.code)?{kind:'not_accepted',code:e.code,retryable:false,retryAfterMs:null}:{kind:'uncertain',code:'META_RESPONSE_UNCERTAIN'};}
 },
 async lookupMessage(){return null;},
};}
