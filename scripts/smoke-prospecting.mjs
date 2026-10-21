import {spawnSync} from 'node:child_process';
import {parseSmokeOptions} from './prospecting-smoke-options.ts';
const args=process.argv.slice(2),options=parseSmokeOptions(args);
if(!options.live){console.log('SKIPPED: real provider calls require --live, --source, --workspace, --limit and explicit --budget-units.');}
else{
  const result=spawnSync(process.execPath,['--conditions=react-server','--experimental-strip-types','scripts/smoke-prospecting-live.ts',...args],{env:process.env,stdio:'inherit'});process.exitCode=result.status??1;
}
