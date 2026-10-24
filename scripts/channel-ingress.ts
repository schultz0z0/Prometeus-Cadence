import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';

const callbackPath=/^\/api\/channel-webhooks\/openwa\/[A-Za-z0-9_-]{8,100}$/;
const maxBytes=1024*1024;
export type ChannelIngressHandler=(request:Request)=>Promise<Response>;
export function createChannelIngress(handler?:ChannelIngressHandler){
 let active=0;
 return createServer({requestTimeout:15000,headersTimeout:10000,maxHeaderSize:16384},async(req,res)=>{
  const finish=(status:number)=>{res.writeHead(status,{'cache-control':'no-store'});res.end();};
  if(req.url==='/health'&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end('{"ok":true}');return;}
  if(!req.url||!callbackPath.test(req.url)){finish(404);return;}
  if(req.method!=='POST'){finish(405);return;}
  if(active>=16){finish(503);return;}
  if(Number(req.headers['content-length']??0)>maxBytes){finish(413);req.resume();return;}
  active++;
  try{
   const parts:Buffer[]=[];let length=0;
   for await(const part of req){length+=part.length;if(length>maxBytes){finish(413);return;}parts.push(part);}
   if(!handler){finish(503);return;}
   const headers=new Headers();for(const [name,value]of Object.entries(req.headers))if(typeof value==='string')headers.set(name,value);
   const request=new Request('http://channel-ingress:3214'+req.url,{method:'POST',headers,body:Buffer.concat(parts)});
   const response=await handler(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{if(!res.headersSent)finish(503);else res.end();}
  finally{active--;}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const server=createChannelIngress();server.listen(3214,'0.0.0.0');
 const shutdown=()=>{server.close(()=>process.exit(0));setTimeout(()=>{server.closeAllConnections();process.exit(1);},10000).unref();};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
