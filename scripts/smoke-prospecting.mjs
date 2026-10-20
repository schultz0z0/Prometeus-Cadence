import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
if(!args.includes('--live')){console.log('SKIPPED: real provider calls require --live, --source, --workspace, --limit and explicit --budget-units.');}
else{
  const source=value('--source'),workspace=value('--workspace'),limit=Number(value('--limit')),units=Number(value('--budget-units'));
  if(!['MAPS','WEB','CNPJ','APOLLO','JEV','CODEX'].includes(source)||!workspace||limit!==1||!Number.isFinite(units)||units!==1)throw Error('Smoke requires explicit source, QA workspace and exactly one record/call unit.');
  const result=spawnSync(process.execPath,['--conditions=react-server','--experimental-strip-types','scripts/smoke-prospecting-live.ts',...args],{env:process.env,stdio:'inherit'});process.exitCode=result.status??1;
}
