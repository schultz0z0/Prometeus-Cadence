import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('Windows GUI launcher runs recovery hidden in the workspace, preserves spaces and forwards exit status',{skip:process.platform!=='win32'},async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'cadence launcher with spaces '));
 try{
  await mkdir(join(workspace,'scripts'));
  await writeFile(join(workspace,'scripts/runtime-control.mjs'),"import fs from 'node:fs';fs.writeFileSync('result.json',JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));process.exit(7);");
  await assert.rejects(promisify(execFile)(join(process.env.SystemRoot??'C:/Windows','System32/wscript.exe'),['//B','//NoLogo',resolve('scripts/runtime-ensure.vbs'),process.execPath,workspace],{windowsHide:true,timeout:15000}),(error:{code?:number|string})=>error.code===7);
  const value=JSON.parse(await readFile(join(workspace,'result.json'),'utf8'));assert.equal(value.cwd,workspace);assert.deepEqual(value.args,['ensure']);
 }finally{await rm(workspace,{recursive:true,force:true});}
});
