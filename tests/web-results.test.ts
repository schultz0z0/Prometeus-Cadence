import test from 'node:test';import assert from 'node:assert/strict';
import {webCompanyPage} from '../src/server/prospecting/web-results.ts';
import {normalizeCandidate} from '../src/server/prospecting/normalize.ts';
const result=(title:string,url:string)=>normalizeCandidate({id:url,name:title,site:url},'WEB');
test('web generation keeps company sites, names them from the matching title part and rejects listings, directories and platforms',()=>{
 const page={receiptId:'r',candidates:[
  result('Melhores empresas de Contabilidade em Curitiba - PR 2026','https://www.contabilidade-ranking.com.br/curitiba'),
  result('Mapa','https://www.google.com/maps'),
  result('Clínica You Odonto em Curitiba - Loqal','https://loqal.com.br/profissional/clinica-you-odonto'),
  result('CONTABILIDADE CURITIBA - FALAVINHA NEXT','https://falavinhanext.com.br/'),
  result('Escritório de Contabilidade em Curitiba | (41) 99224-5900','https://www.contabilcuritiba.com.br/'),
 ],rejected:[],rawCount:5,nextCursor:null,exhausted:true,usage:{provider:'apify',operationId:'r',units:{candidates:5},costUsd:null,costKind:'unknown' as const}};
 const out=webCompanyPage(page);
 assert.deepEqual(out.candidates.map(c=>[c.name,c.phone??null]),[['FALAVINHA NEXT',null],['Escritório de Contabilidade em Curitiba','41992245900']]);
 assert.deepEqual(out.rejected,[{reason:'NOT_A_COMPANY_SITE'},{reason:'NOT_A_COMPANY_SITE'},{reason:'NOT_A_COMPANY_SITE'}]);
 assert.equal(out.rawCount,5,'the scanned volume is unchanged');
});
