import type {AttachmentView} from '../domain/message-authoring.ts';
export function createMessageFilesClient(options:{workspaceId:string;fetcher?:typeof fetch}){
 const fetcher=options.fetcher??fetch,controllers=new Set<AbortController>(),uploads=new WeakMap<File,string>();let disposed=false;
 async function request<T>(url:string,init:RequestInit,read:(response:Response)=>Promise<T>){if(disposed)throw Error('O workspace mudou.');const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),60000);try{const response=await fetcher(url,{...init,credentials:'same-origin',cache:'no-store',headers:{...Object.fromEntries(new Headers(init.headers)),'x-cadence-workspace':options.workspaceId},signal:controller.signal});if(disposed)throw Error('O workspace mudou.');if(!response.ok){const data=await response.json().catch(()=>null);throw Error(data?.message??'Não foi possível acessar o arquivo.');}const result=await read(response);if(disposed)throw Error('O workspace mudou.');return result;}finally{clearTimeout(timer);controllers.delete(controller);}}
 return{
 async list(ids:string[]):Promise<AttachmentView[]>{if(!ids.length)return[];return request('/api/message-files?ids='+encodeURIComponent(ids.join(',')),{},r=>r.json());},
 async unused(cursor?:string):Promise<{files:AttachmentView[];usedBytes:number;quotaBytes:number;nextCursor:string|null}>{return request('/api/message-files?unused=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{},r=>r.json());},
 async removeUnused(id:string):Promise<{removed:true}>{return request('/api/message-files/'+encodeURIComponent(id),{method:'DELETE'},r=>r.json());},
 async upload(file:File):Promise<AttachmentView>{let id=uploads.get(file);if(!id){id=crypto.randomUUID();uploads.set(file,id);}const body=new FormData();body.set('file',file);return request('/api/message-files',{method:'POST',headers:{'x-upload-id':id},body},r=>r.json());},
 async download(id:string){return request('/api/message-files/'+encodeURIComponent(id),{},async r=>{const blob=await r.blob(),value=r.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];let name='attachment';try{if(value)name=decodeURIComponent(value);}catch{}return{blob,name};});},
 dispose(){disposed=true;for(const c of controllers)c.abort();controllers.clear();},
 };
}
