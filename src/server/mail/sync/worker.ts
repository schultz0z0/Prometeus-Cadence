import type {SyncLease} from '../../../domain/mail.ts';
import type {MailDeps} from '../providers/contracts.ts';
interface TickOptions {now:string;workspaceId?:string;mailboxId?:string;maxMailboxes:number;maxMessages:number;allowSync?:boolean;signal?:AbortSignal}
type Result={messages:number;complete:boolean;gap:boolean};
type TickDeps=MailDeps&{enabled?:boolean;claim?:(now:string,scope:{workspaceId?:string;mailboxId?:string;limit:number})=>Promise<SyncLease[]>;run?:(lease:SyncLease,budget:{maxMessages:number;maxPages:number})=>Promise<Result>};
export async function runMailSyncTick(options:TickOptions,deps:TickDeps={}){
 if(!Number.isFinite(Date.parse(options.now))||!Number.isInteger(options.maxMailboxes)||options.maxMailboxes<1||options.maxMailboxes>10||!Number.isInteger(options.maxMessages)||options.maxMessages<1||options.maxMessages>100||options.mailboxId&&!options.workspaceId)throw Error('INVALID_SYNC_SCOPE');
 const result={disabled:!(options.allowSync&&(deps.enabled??process.env.MAIL_SYNC_ENABLED==='true')),mailboxes:0,messages:0,complete:0,pending:0,gaps:0,failed:0};if(result.disabled||options.signal?.aborted)return result;
 const claim=deps.claim??(await import('./repository.ts')).claimMailboxSync,run=deps.run??(async(lease,budget)=>(await import('./service.ts')).runMailboxSync(lease,{...deps,...budget}));
 const seen=new Set<string>();
 for(let i=0;i<options.maxMailboxes;i++){
  if(options.signal?.aborted)break;
  // Claim just before use: later mailboxes do not lose their lease while an
  // earlier account waits for network timeouts. The fixed tick clock and the
  // SQL 60-second next_at prevent reclaiming a completed mailbox in this tick.
  const [lease]=await claim(options.now,{workspaceId:options.workspaceId,mailboxId:options.mailboxId,limit:1});if(!lease||seen.has(lease.workspaceId+':'+lease.mailboxId))break;seen.add(lease.workspaceId+':'+lease.mailboxId);
  result.mailboxes++;try{const value=await run(lease,{maxMessages:options.maxMessages,maxPages:5});result.messages+=value.messages;if(value.complete)result.complete++;else result.pending++;if(value.gap)result.gaps++;}catch{result.failed++;}
 }
 return result;
}
