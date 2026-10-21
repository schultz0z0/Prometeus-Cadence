import {providerJson,ProviderError} from '../providers/transport.ts';
import type {Fetch} from '../providers/types.ts';
import {validTokens} from './openai.ts';
export async function geminiJson(model:string,prompt:string,schema:unknown,signal:AbortSignal,fetcher:Fetch=fetch){
 if(!/^[a-zA-Z0-9._-]{1,120}$/.test(model))throw new ProviderError('INVALID_MODEL');
 const raw:any=await providerJson(fetcher,'https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{method:'POST',headers:{'x-goog-api-key':process.env.GEMINI_API_KEY??'','content-type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseFormat:{text:{mimeType:'APPLICATION_JSON',schema}},maxOutputTokens:4096}})},signal);
 try{if(raw.promptFeedback?.blockReason||raw.candidates?.length!==1||raw.candidates[0].finishReason!=='STOP')throw Error();const parts=raw.candidates[0].content.parts;if(!Array.isArray(parts)||parts.some((p:any)=>typeof p.text!=='string'||p.functionCall))throw Error();return{value:JSON.parse(parts.map((p:any)=>p.text).join('')),inputTokens:validTokens(raw.usageMetadata?.promptTokenCount),outputTokens:validTokens(raw.usageMetadata?.candidatesTokenCount)};}catch{throw new ProviderError('GEMINI_RESULT_UNAVAILABLE',0,true);}
}
