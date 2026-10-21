export function parseWhatsappSmoke(env:Record<string,string|undefined>,args:string[]):{enabled:false}|{enabled:true;mode:'prepare'|'confirm';base:string;workspaceId:string;connectionId:string;cookie:string;phone:string;inputFile:string}{
 if(env.WHATSAPP_SMOKE_ENABLED!=='true')return {enabled:false};
 if(args.length!==1||!['--prepare','--confirm'].includes(args[0]))throw Error('Select prepare or confirm');
 for(const key of ['SMOKE_WORKSPACE_ID','SMOKE_CONNECTION_ID','SMOKE_COOKIE','SMOKE_TEST_PHONE','WHATSAPP_SMOKE_INPUT_FILE'])if(!env[key])throw Error('Missing smoke configuration');
 const base=new URL(env.SMOKE_URL??'http://127.0.0.1:3210');
 if(!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.protocol!=='http:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('Smoke requires the local app origin');
 const allowlist=JSON.parse(env.WHATSAPP_SMOKE_ALLOWLIST??'[]') as unknown;
 if(!Array.isArray(allowlist)||!allowlist.includes(env.SMOKE_TEST_PHONE)||!/^\+[1-9]\d{6,14}$/.test(env.SMOKE_TEST_PHONE!))throw Error('Recipient is not allowlisted');
 return {enabled:true,mode:args[0]==='--prepare'?'prepare':'confirm',base:base.origin,workspaceId:env.SMOKE_WORKSPACE_ID!,connectionId:env.SMOKE_CONNECTION_ID!,cookie:env.SMOKE_COOKIE!,phone:env.SMOKE_TEST_PHONE!,inputFile:env.WHATSAPP_SMOKE_INPUT_FILE!};
}
