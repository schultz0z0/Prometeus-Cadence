import test from 'node:test';
import assert from 'node:assert/strict';
import * as exports from '../src/client/contacts-export.ts';
const api=exports as any;
test('export refuses a changing dataset, repeated page IDs and oversized workspaces instead of a partial file',async()=>{
 assert.equal(typeof api.collectContactExport,'function');
 const page=(n:number)=>({items:Array.from({length:100},(_,i)=>({id:String((n-1)*100+i)})),total:200,revision:1});
 assert.equal((await api.collectContactExport(async(n:number)=>page(n))).length,200);
 await assert.rejects(api.collectContactExport(async(n:number)=>({...page(n),revision:n})),/mudaram/);
 await assert.rejects(api.collectContactExport(async()=>page(1)),/mudaram/);
 await assert.rejects(api.collectContactExport(async()=>({...page(1),total:10001})),/10.000/);
});
test('CSV cells cannot execute a spreadsheet formula',()=>{assert.equal(typeof api.csvCell,'function');assert.equal(api.csvCell('=1+1'),'"\'=1+1"');assert.equal(api.csvCell('A "quoted" name'),'"A ""quoted"" name"');});
