import type {Fetch} from './types.ts';
export class ProviderError extends Error{code:string;status:number;uncertain:boolean;constructor(code:string,status=0,uncertain=false){super('O provedor não concluiu a operação ('+code+').');this.name='ProviderError';this.code=code;this.status=status;this.uncertain=uncertain;}}
export async function providerJson(fetcher:Fetch,url:string,init:RequestInit,signal:AbortSignal){
  const method=init.method??'GET',attempts=method==='GET'?3:1;
  for(let attempt=0;attempt<attempts;attempt++){
    let response:Response;
    try{response=await fetcher(url,{...init,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});}
    catch{if(attempt+1<attempts&&!signal.aborted)continue;throw new ProviderError('NETWORK',0,method==='POST');}
    if(!response.ok){
      if(method==='GET'&&[429,500,502,503,504].includes(response.status)&&attempt+1<attempts)continue;
      throw new ProviderError('HTTP_'+response.status,response.status,method==='POST'&&response.status>=500);
    }
    // Bound even a lying Content-Length; provider response bodies never enter errors/logs.
    const reader=response.body?.getReader();if(!reader)throw new ProviderError('EMPTY_RESPONSE');
    const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000){await reader.cancel();throw new ProviderError('RESPONSE_TOO_LARGE');}chunks.push(value);}}
    catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError('RESPONSE_LOST',0,method==='POST');}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}catch{throw new ProviderError('INVALID_JSON',0,method==='POST');}
  }throw new ProviderError('NETWORK');
}
