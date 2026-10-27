import test from 'node:test';import assert from 'node:assert/strict';
import {jobInputSchema} from '../src/server/prospecting/schemas.ts';
const base={kind:'qualification',listId:'list',leadIds:['lead'],modules:['email'],summaryPolicy:'all',escalation:'off'};
test('qualification supports explicit selection controls and a separate bounded enrichment mode',()=>{
 assert.equal(jobInputSchema.safeParse({...base,options:{onlyWithSite:true,onlyMissingEmail:true,skipProcessed:true,language:'pt-BR'}}).success,true);
 assert.equal(jobInputSchema.safeParse({...base,modules:['decisors'],enrichment:{maxCredits:5,destinationName:'Decisores'}}).success,true);
 for(const patch of [{modules:['email','decisors'],enrichment:{maxCredits:5,destinationName:'Pessoas'}},{modules:['decisors']},{modules:['email'],enrichment:{maxCredits:5,destinationName:'Pessoas'}},{modules:['decisors'],enrichment:{maxCredits:101,destinationName:'Pessoas'}},{options:{language:'random'}},{options:{onlyWithSite:'yes'}}])assert.equal(jobInputSchema.safeParse({...base,...patch}).success,false);
});
