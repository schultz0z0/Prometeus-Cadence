import'server-only';
import{workerPool}from'../prospecting/worker-db.ts';
// Batches keep each statement short; a large backlog is cleared over several ticks.
export async function purgeExpiredMessageText(options:{limit:number;signal:AbortSignal}){
 if(!Number.isInteger(options.limit)||options.limit<1||options.limit>5000)throw Error('Invalid retention batch');
 let purged=0;
 while(!options.signal.aborted){const n=Number((await workerPool().query('SELECT app.purge_message_text($1) n',[options.limit])).rows[0].n);purged+=n;if(n<options.limit)break;}
 return{purged};
}
