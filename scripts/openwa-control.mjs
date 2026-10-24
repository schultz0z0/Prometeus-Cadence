import {spawn} from 'node:child_process';import {ensureOpenwaEnvironment} from './openwa-environment.mjs';
const action=process.argv[2]??'status';
if(!['start','status','stop'].includes(action)){console.error('Use openwa:start, openwa:status or openwa:stop.');process.exit(2);}
ensureOpenwaEnvironment();
const args=['compose','--env-file','.env.local','--profile','channels'];
args.push(...(action==='start'?['up','-d','--build','--no-deps','--wait','--wait-timeout','180']:action==='stop'?['stop']:['ps','--format','json']),'openwa','channel-ingress');
const child=spawn('docker',args,{windowsHide:true,stdio:action==='status'?['ignore','pipe','pipe']:'ignore'});
let output='';child.stdout?.on('data',v=>output+=v);child.stderr?.resume();
child.once('error',()=>{console.error('OpenWA control unavailable. Check Docker and local configuration.');process.exitCode=1;});
child.once('exit',code=>{
 if(action==='status'&&code===0){for(const line of output.trim().split('\n').filter(Boolean)){try{const row=JSON.parse(line);console.log(JSON.stringify({service:row.Service,state:row.State,health:row.Health}));}catch{process.exitCode=1;}}}
 else console.log(code===0?`OpenWA ${action}: complete.`:`OpenWA ${action}: failed. Check local Docker build and service health.`);
 process.exitCode=code??1;
});
