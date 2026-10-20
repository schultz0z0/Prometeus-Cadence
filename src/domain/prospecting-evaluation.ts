export type Verdict='fits'|'does_not_fit'|'insufficient_evidence';
export interface GoldCase{id:string;companyId:string;domain:string;split:'adjust'|'test';label:Exclude<Verdict,'insufficient_evidence'>}
export interface Prediction{id:string;verdict:Verdict;costUsd:number|null;latencyMs:number;escalated:boolean;model?:string;contractVersion?:string;evidenceHashes?:string[]}
const domain=(value:string)=>new URL(value.includes('://')?value:'https://'+value).hostname.toLowerCase().replace(/^www\./,'');
export function validateEvaluationSet(rows:GoldCase[]){
  const ids=new Set<string>(),companies=new Map<string,string>(),domains=new Map<string,string>();
  if(!rows.length)throw Error('Empty evaluation set.');
  for(const row of rows){
    if(!row.id||!row.companyId||!row.domain||!['adjust','test'].includes(row.split)||!['fits','does_not_fit'].includes(row.label)||ids.has(row.id))throw Error('Invalid or duplicate gold case.');ids.add(row.id);
    const host=domain(row.domain);
    if((companies.has(row.companyId)&&companies.get(row.companyId)!==row.split)||(domains.has(host)&&domains.get(host)!==row.split))throw Error('Evaluation split leaks company or domain.');
    companies.set(row.companyId,row.split);domains.set(host,row.split);
  }return rows;
}
export function evaluatePredictions(gold:GoldCase[],predictions:Prediction[]){
  validateEvaluationSet(gold);const rows=new Map<string,Prediction>();
  for(const p of predictions){if(rows.has(p.id)||!gold.some(g=>g.id===p.id)||!['fits','does_not_fit','insufficient_evidence'].includes(p.verdict)||!(p.costUsd===null||Number.isFinite(p.costUsd)&&p.costUsd>=0)||!Number.isFinite(p.latencyMs)||p.latencyMs<0||typeof p.escalated!=='boolean')throw Error('Invalid prediction.');rows.set(p.id,p);}
  if(rows.size!==gold.length)throw Error('Every gold case needs a prediction.');
  const confusion={fits:{fits:0,does_not_fit:0,insufficient_evidence:0},does_not_fit:{fits:0,does_not_fit:0,insufficient_evidence:0}};
  for(const g of gold)confusion[g.label][rows.get(g.id)!.verdict]++;
  const tp=confusion.fits.fits,fp=confusion.does_not_fit.fits,fn=confusion.fits.does_not_fit+confusion.fits.insufficient_evidence;
  const abstentions=predictions.filter(p=>p.verdict==='insufficient_evidence').length,latencies=predictions.map(p=>p.latencyMs).sort((a,b)=>a-b),q=(percent:number)=>latencies[Math.max(0,Math.ceil(percent*latencies.length)-1)];
  return{count:gold.length,confusion,fits:{precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null},abstentionRate:abstentions/gold.length,coverage:1-abstentions/gold.length,escalationRate:predictions.filter(p=>p.escalated).length/gold.length,knownCostUsd:Number(predictions.reduce((sum,p)=>sum+(p.costUsd??0),0).toFixed(12)),hasUnknownCost:predictions.some(p=>p.costUsd===null),latencyMs:{p50:q(0.5),p95:q(0.95)}};
}
