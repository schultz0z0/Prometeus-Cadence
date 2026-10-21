export interface WorkspaceTransportOptions{workspaceId:string;transport?:typeof fetch;onAccessLost?:(message:string)=>void}
export function createWorkspaceTransport(options:WorkspaceTransportOptions){
 const transport=options.transport??fetch,controller=new AbortController();let disposed=false;
 return {
  async request<T>(path:string,body?:unknown):Promise<T>{
   if(disposed)throw Error('O acesso ao workspace mudou.');
   if(!path.startsWith('/api/'))throw Error('Rota do workspace inválida.');
   const response=await transport(path,{method:body===undefined?'GET':'POST',cache:'no-store',signal:controller.signal,headers:{'x-cadence-workspace':options.workspaceId,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const data=await response.json();if(disposed)throw Error('A resposta pertence a um workspace anterior.');
   if(!response.ok){
    if(response.status===401||response.status===403||data.code==='WORKSPACE_CHANGED'){disposed=true;controller.abort();options.onAccessLost?.(data.message??'O acesso ao workspace mudou.');}
    throw Object.assign(Error(data.message??'Não foi possível concluir a operação.'),{status:response.status,code:data.code});
   }
   return data as T;
  },
  dispose(){disposed=true;controller.abort();},
 };
}
