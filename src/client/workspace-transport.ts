export interface WorkspaceTransportOptions{workspaceId:string;transport?:typeof fetch;onAccessLost?:(message:string)=>void}
export function createWorkspaceTransport(options:WorkspaceTransportOptions){
 const transport=options.transport??fetch,controller=new AbortController();let disposed=false;
 const reads=new Map<string,Promise<unknown>>();let generation=0;
 async function perform<T>(path:string,body?:unknown):Promise<T>{
   const ticket=generation;
   const response=await transport(path,{method:body===undefined?'GET':'POST',cache:'no-store',signal:body===undefined?AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]):controller.signal,headers:{'x-cadence-workspace':options.workspaceId,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const data=await response.json();if(disposed)throw Error('A resposta pertence a um workspace anterior.');
   if(!response.ok){
    if(response.status===401||response.status===403||data.code==='WORKSPACE_CHANGED'){disposed=true;controller.abort();reads.clear();options.onAccessLost?.(data.message??'O acesso ao workspace mudou.');}
    throw Object.assign(Error(data.message??'Não foi possível concluir a operação.'),{status:response.status,code:data.code});
   }
   if(body===undefined&&ticket!==generation)throw Error('Os dados mudaram durante a consulta. Atualize antes de continuar.');
   return data as T;
 }
 return {
  async request<T>(path:string,body?:unknown):Promise<T>{
   if(disposed)throw Error('O acesso ao workspace mudou.');
   if(!path.startsWith('/api/'))throw Error('Rota do workspace inválida.');
   if(body!==undefined){generation++;reads.clear();try{return await perform<T>(path,body);}finally{generation++;reads.clear();}}
   const ticket=generation;
   let read=reads.get(path);
   if(!read){read=perform(path);reads.set(path,read);const clear=()=>{if(reads.get(path)===read)reads.delete(path);};void read.then(clear,clear);}
   const result=await read;if(disposed)throw Error('A resposta pertence a um workspace anterior.');if(ticket!==generation)throw Error('Os dados mudaram durante a consulta. Atualize antes de continuar.');return structuredClone(result) as T;
  },
  dispose(){disposed=true;controller.abort();reads.clear();},
 };
}
