import {withOAuthLock} from '../../src/server/ai-oauth/lock.ts';
try{
 await withOAuthLock(process.argv[2],async()=>{process.send?.('acquired');await new Promise<void>(resolve=>process.once('message',()=>resolve()));});
 process.disconnect?.();
}catch{process.send?.('failed');process.exitCode=1;process.disconnect?.();}
