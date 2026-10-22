import tls from 'node:tls';import {mailTestTls} from './smtp-server.ts';
export async function imapFixture(){
 const commands:string[]=[],sockets=new Set<tls.TLSSocket>();
 const server=tls.createServer(mailTestTls,socket=>{
  sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));socket.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] Test IMAP ready\r\n');let pending='',authTag='';
  socket.on('data',bytes=>{pending+=bytes.toString();let at:number;while((at=pending.indexOf('\r\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+2);
   if(authTag){const value=Buffer.from(line,'base64').toString(),tag=authTag;authTag='';socket.write(tag+(value.endsWith('fixture-imap-password')?' OK authenticated':' NO invalid credentials')+'\r\n');continue;}
   const [tag,raw,...args]=line.split(' '),command=raw?.toUpperCase();commands.push(command??'');
   if(command==='CAPABILITY')socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n'+tag+' OK done\r\n');
   else if(command==='AUTHENTICATE'){if(args.length>1){const v=Buffer.from(args[1],'base64').toString();socket.write(tag+(v.endsWith('fixture-imap-password')?' OK authenticated':' NO invalid credentials')+'\r\n');}else{authTag=tag;socket.write('+ \r\n');}}
   else if(command==='LOGIN')socket.write(tag+(line.includes('fixture-imap-password')?' OK authenticated':' NO invalid credentials')+'\r\n');
   else if(command==='LIST')socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n'+tag+' OK done\r\n');
   else if(command==='EXAMINE')socket.write('* FLAGS (\\Seen)\r\n* 0 EXISTS\r\n* OK [UIDVALIDITY 9007199254740993999] Valid\r\n* OK [UIDNEXT 1] Next\r\n'+tag+' OK [READ-ONLY] done\r\n');
   else if(command==='SELECT'||command==='CLOSE'||command==='STORE'||command==='EXPUNGE'||command==='APPEND')socket.write(tag+' NO mutation not permitted\r\n');
   else if(command==='UID'&&args[0]?.toUpperCase()==='SEARCH')socket.write('* SEARCH\r\n'+tag+' OK done\r\n');
   else if(command==='LOGOUT'){socket.write('* BYE done\r\n'+tag+' OK logout\r\n');socket.end();}
   else socket.write(tag+' OK done\r\n');
  }});
 });server.on('error',()=>{});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;
 return {port,commands,close:()=>new Promise<void>(resolve=>{for(const s of sockets)s.destroy();server.close(()=>resolve());})};
}
