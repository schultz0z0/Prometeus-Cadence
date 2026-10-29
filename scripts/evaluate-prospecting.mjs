import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {validateEvaluationSet,evaluatePredictions} from '../src/domain/prospecting-evaluation.ts';
export async function loadEvaluationSet(file){const rows=JSON.parse(await fs.readFile(file,'utf8'));if(!Array.isArray(rows))throw Error('Gold set must be a JSON array.');return validateEvaluationSet(rows);}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 if(process.argv[2]==='--research'){
  const {runEvaluationCli}=await import('./evaluate-research.ts'),result=await runEvaluationCli(process.argv.slice(3));console.log(JSON.stringify(result.result,null,2));process.exitCode=result.exitCode;
 }else{
  const [goldFile,predictionsFile,split='test']=process.argv.slice(2);
  if(!goldFile||!predictionsFile||!['adjust','test'].includes(split))throw Error('Usage: evaluate-prospecting.mjs gold.json predictions.json [adjust|test]');
  const all=await loadEvaluationSet(goldFile),gold=all.filter(row=>row.split===split),ids=new Set(gold.map(row=>row.id));
  const predictions=JSON.parse(await fs.readFile(predictionsFile,'utf8'));
  console.log(JSON.stringify({split,report:evaluatePredictions(gold,predictions.filter(p=>ids.has(p.id)))},null,2));
 }
}
