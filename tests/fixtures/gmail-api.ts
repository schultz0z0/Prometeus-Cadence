export function gmailApi(address='sender@example.org'){
 const calls:{url:string;method:string;body:string}[]=[];
 const flags={invalidGrant:false,omitRefresh:false,missingScope:false,lostSend:false,expiresIn:3600};
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(String(input)),method=init?.method??'GET',body=String(init?.body??'');calls.push({url:url.toString(),method,body});
  if(url.hostname==='oauth2.googleapis.com'){
   if(flags.invalidGrant)return Response.json({error:'invalid_grant'},{status:400});
   return Response.json({access_token:'fixture-access',token_type:'Bearer',expires_in:flags.expiresIn,...(!flags.omitRefresh?{refresh_token:'fixture-refresh'}:{}),scope:'https://www.googleapis.com/auth/gmail.send'+(!flags.missingScope?' https://www.googleapis.com/auth/gmail.readonly':'')});
  }
  if(url.pathname.endsWith('/profile'))return Response.json({emailAddress:address,historyId:'9007199254740993999',messagesTotal:1,threadsTotal:1});
  if(url.pathname.endsWith('/messages/send')){if(flags.lostSend)throw Error('connection lost after server accepted');return Response.json({id:'remote-send',threadId:'remote-thread',labelIds:['SENT']});}
  return Response.json({messages:[],resultSizeEstimate:0});
 };return {fetcher,calls,flags};
}
