import {execFileSync} from 'node:child_process';import {randomBytes} from 'node:crypto';import {writeFileSync,mkdirSync,unlinkSync} from 'node:fs';import {resolve} from 'node:path';
export function withOpenwaQaReceiver<T>(fn:(post:(path:string,raw:string,secret:string)=>number)=>Promise<T>):Promise<T>{
 const url=new URL(process.env.INGRESS_DATABASE_URL!);if(!/^\/prometeus_it_[a-f0-9]{16}_test$/.test(url.pathname))throw Error('Ephemeral database required');url.hostname='db';url.port='5432';
 const folder=resolve('.runtime/openwa-qa');mkdirSync(folder,{recursive:true});const envPath=resolve(folder,'env-'+randomBytes(8).toString('hex'));
 const values={INGRESS_DATABASE_URL:url.toString(),CHANNEL_ACTIVE_KEY_ID:process.env.CHANNEL_ACTIVE_KEY_ID!,CHANNEL_KEYRING_JSON:process.env.CHANNEL_KEYRING_JSON!,OPENWA_ADMIN_API_KEY:randomBytes(32).toString('hex')};
 writeFileSync(envPath,Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
 const args=['compose','--env-file',envPath,'-f','docker/compose.openwa-qa.yaml'];
 const run=(more:string[],input?:string)=>{try{return execFileSync('docker',[...args,...more],{encoding:'utf8',windowsHide:true,timeout:120000,input,env:{...process.env,...values},stdio:['pipe','pipe','pipe']});}catch{throw Error('Private QA receiver command failed; no environment or payload logged.');}};
 return (async()=>{
  try{
   run(['up','-d','--no-deps','--wait','channel-ingress']);
   const post=(path:string,raw:string,secret:string)=>{
    const script=`import{createHmac}from'node:crypto';const data=${JSON.stringify({path,raw,secret})};const response=await fetch('http://127.0.0.1:3214'+data.path,{method:'POST',headers:{'content-type':'application/json','x-openwa-signature':'sha256='+createHmac('sha256',data.secret).update(data.raw).digest('hex')},body:data.raw});console.log(response.status);`;
    return Number(run(['exec','-T','channel-ingress','node','--input-type=module'],script).trim());
   };
   return await fn(post);
  }finally{try{run(['down','--remove-orphans']);}finally{unlinkSync(envPath);}}
 })();
}
