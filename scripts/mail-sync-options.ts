export function parseMailSyncOptions(args:string[]){
 const values=new Map<string,string>(),flags=new Set<string>(),allowed=new Set(['--once','--allow-sync','--all-workspaces','--workspace','--mailbox','--max-mailboxes','--max-messages']);
 for(let i=0;i<args.length;i++){const key=args[i];if(!allowed.has(key)||flags.has(key)||values.has(key))throw Error('Invalid sync option');if(['--workspace','--mailbox','--max-mailboxes','--max-messages'].includes(key)){const value=args[++i];if(!value||value.startsWith('--')||value.length>120)throw Error('Invalid sync value');values.set(key,value);}else flags.add(key);}
 const workspaceId=values.get('--workspace'),mailboxId=values.get('--mailbox'),allowSync=flags.has('--allow-sync');if(workspaceId&&flags.has('--all-workspaces')||mailboxId&&!workspaceId||allowSync&&!workspaceId&&!flags.has('--all-workspaces'))throw Error('Explicit compatible sync scope required');
 const bound=(key:string,fallback:number,max:number)=>{const value=values.get(key)??String(fallback);if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>max)throw Error('Invalid sync budget');return Number(value);};
 return {once:flags.has('--once'),allowSync,workspaceId,mailboxId,maxMailboxes:bound('--max-mailboxes',1,10),maxMessages:bound('--max-messages',100,100)};
}
export function mailSyncEnabled(env:Record<string,string|undefined>,options:{allowSync:boolean}){return env.MAIL_SYNC_ENABLED==='true'&&options.allowSync;}
