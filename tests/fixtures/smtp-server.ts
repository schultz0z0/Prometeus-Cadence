// Public test key/certificate, trusted only by the local fixture factories.
import {readFileSync} from 'node:fs';import {SMTPServer} from 'smtp-server';
export const mailTestTls={key:readFileSync(new URL('./mail-test-key.pem',import.meta.url)),cert:readFileSync(new URL('./mail-test-cert.pem',import.meta.url))};
export async function smtpFixture(options:{secure?:boolean;noStartTls?:boolean}={}){
 const state={dataCount:0,messages:[] as string[],mode:'accept' as 'accept'|'temporary'|'permanent'|'lost'};
 const server=new SMTPServer({secure:options.secure??true,...mailTestTls,logger:false,disabledCommands:options.noStartTls?['STARTTLS']:[],closeTimeout:500,
  onAuth(auth,_session,done){auth.password==='fixture-smtp-password'?done(null,{user:'fixture'}):done(Object.assign(Error('Invalid login'),{responseCode:535}));},
  onData(stream,session,done){state.dataCount++;const chunks:Buffer[]=[];stream.on('data',c=>chunks.push(c));stream.on('end',()=>{state.messages.push(Buffer.concat(chunks).toString());if(state.mode==='lost'){for(const connection of server.connections)if(connection.session.id===session.id)connection.close();return;}
   if(state.mode!=='accept'){done(Object.assign(Error('Fixture rejection'),{responseCode:state.mode==='temporary'?451:550}));return;}done(null,'fixture-accepted');});}
 });server.on('error',()=>{});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.server.address() as {port:number}).port;
 return {state,port,close:()=>new Promise<void>(resolve=>{for(const c of server.connections)c.close();server.close(resolve);})};
}
