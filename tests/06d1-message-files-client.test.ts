import test from 'node:test';import assert from 'node:assert/strict';import {createMessageFilesClient} from '../src/client/message-files-client.ts';
test('file retry keeps upload identity, workspace is explicit and errors never report a saved file',async()=>{
 const ids:string[]=[],workspaces:string[]=[];let calls=0;const client=createMessageFilesClient({workspaceId:'own',fetcher:async(_url,init)=>{ids.push(new Headers(init?.headers).get('x-upload-id')!);workspaces.push(new Headers(init?.headers).get('x-cadence-workspace')!);if(!calls++)throw Error('Lost response');return Response.json({id:'file',name:'file.pdf',mime:'application/pdf',size:12,state:'ready'});}}),file=new File(['%PDF-1.7'],'file.pdf',{type:'application/pdf'});
 await assert.rejects(client.upload(file));assert.equal((await client.upload(file)).state,'ready');assert.equal(ids[0],ids[1]);assert.deepEqual(workspaces,['own','own']);client.dispose();
});
test('disposal aborts the old workspace and discards even a delayed successful file response',async()=>{
 let release!:(r:Response)=>void,signal:AbortSignal|null|undefined;const client=createMessageFilesClient({workspaceId:'old',fetcher:async(_url,init)=>{signal=init?.signal;return new Promise<Response>(resolve=>release=resolve);}}),read=client.list(['file']);client.dispose();assert.equal(signal?.aborted,true);release(Response.json([{id:'private-old'}]));await assert.rejects(read);await assert.rejects(client.list(['file']));
});
test('file management is workspace scoped, paginated and only deletes the explicit file ID',async()=>{
 const calls:{url:string;method:string;workspace:string|null}[]=[];const client=createMessageFilesClient({workspaceId:'own',fetcher:async(url,init)=>{calls.push({url:String(url),method:init?.method??'GET',workspace:new Headers(init?.headers).get('x-cadence-workspace')});return Response.json({files:[],usedBytes:0,quotaBytes:209715200,nextCursor:null,removed:true});}});
 await client.unused('cursor');await client.removeUnused('file');assert.deepEqual(calls,[{url:'/api/message-files?unused=1&cursor=cursor',method:'GET',workspace:'own'},{url:'/api/message-files/file',method:'DELETE',workspace:'own'}]);client.dispose();
});
