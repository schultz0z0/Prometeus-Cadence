export function parseEmailSmoke(env:Record<string,string|undefined>,args:string[]):{enabled:false}|{enabled:true;mode:'prepare'|'confirm';base:string;workspaceId:string;mailboxId:string;cookie:string;to:string;inputFile:string}{
 if(env.EMAIL_SMOKE_ENABLED!=='true')return {enabled:false};if(args.length!==1||!['--prepare','--confirm'].includes(args[0]))throw Error('Select prepare or confirm');
 for(const key of ['SMOKE_WORKSPACE_ID','SMOKE_CONNECTION_ID','SMOKE_COOKIE','SMOKE_TEST_EMAIL','EMAIL_SMOKE_INPUT_FILE'])if(!env[key])throw Error('Missing mail smoke configuration');
 const base=new URL(env.SMOKE_URL??'http://127.0.0.1:3210');if(!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.protocol!=='http:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('Local app origin required');
 const allowlist:unknown=JSON.parse(env.EMAIL_SMOKE_ALLOWLIST??'[]');if(!Array.isArray(allowlist)||!allowlist.includes(env.SMOKE_TEST_EMAIL)||!/^\S+@\S+\.\S+$/.test(env.SMOKE_TEST_EMAIL!))throw Error('Recipient is not allowlisted');
 return {enabled:true,mode:args[0]==='--prepare'?'prepare':'confirm',base:base.origin,workspaceId:env.SMOKE_WORKSPACE_ID!,mailboxId:env.SMOKE_CONNECTION_ID!,cookie:env.SMOKE_COOKIE!,to:env.SMOKE_TEST_EMAIL!,inputFile:env.EMAIL_SMOKE_INPUT_FILE!};
}
export function validateSmokeReview(saved:any,expected:{workspaceId:string;mailboxId:string;hash:string;requestId:string},now:number){
 if(!saved||Object.entries(expected).some(([key,value])=>saved[key]!==value)||!Array.isArray(saved.review?.blockers)||saved.review.blockers.length||!Number.isFinite(Date.parse(saved.review.expiresAt))||Date.parse(saved.review.expiresAt)<=now)throw Error('Review changed or expired');return true;
}
