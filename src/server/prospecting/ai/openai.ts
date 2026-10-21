import {providerJson,ProviderError} from '../providers/transport.ts';
import type {Fetch} from '../providers/types.ts';
export async function openaiJson(model:string,prompt:string,schema:unknown,signal:AbortSignal,fetcher:Fetch=fetch,maxOutputTokens=4096){
 const raw:any=await providerJson(fetcher,'https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},body:JSON.stringify({model,store:false,input:[{role:'user',content:prompt}],text:{format:{type:'json_schema',name:'cadence_result',strict:true,schema}},max_output_tokens:maxOutputTokens})},signal);
 try{if(raw.status!=='completed'||!Array.isArray(raw.output))throw Error();let text='';for(const item of raw.output){if(item.type==='reasoning')continue;if(item.type!=='message'||!Array.isArray(item.content))throw Error();for(const c of item.content){if(c.type!=='output_text'||typeof c.text!=='string')throw Error();text+=c.text;}}return{value:JSON.parse(text),inputTokens:validTokens(raw.usage?.input_tokens),outputTokens:validTokens(raw.usage?.output_tokens)};}catch{throw new ProviderError('OPENAI_RESULT_UNAVAILABLE',0,true);}
}
export function validTokens(value:unknown){return Number.isSafeInteger(value)&&Number(value)>=0?Number(value):undefined;}
