import fs from 'node:fs';import {randomBytes} from 'node:crypto';
export function ensureOpenwaEnvironment(path='.env.local'){
 if(!fs.existsSync(path))throw Error('Local environment required.');
 const existing=fs.readFileSync(path,'utf8');
 const defaults={OPENWA_ADMIN_API_KEY:randomBytes(32).toString('hex'),OPENWA_API_ORIGIN:'http://127.0.0.1:2785',OPENWA_PLATFORM_DAILY_CAP:'20',OPENWA_PLATFORM_NEW_CONVERSATION_CAP:'5',RUNTIME_CHANNELS_MS:'5000'};
 const missing=Object.entries(defaults).filter(([name])=>!new RegExp(`^${name}=`,'m').test(existing));
 if(missing.length)fs.appendFileSync(path,'\n'+missing.map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
}
