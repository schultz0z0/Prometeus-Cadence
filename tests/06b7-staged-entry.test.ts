import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createProspectingClient} from '../src/client/prospecting-client.ts';
const read=(path:string)=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
test('06B.7 standard entries offer four sources and no integrated journey trigger',()=>{
 for(const file of ['modules/prospecting/server-generator.tsx','modules/automations/server-audience-wizard.tsx','modules/prospecting/research-journey.tsx'])assert.doesNotMatch(read(file),/JourneyStart|rospecção completa|prepareJourney|resumeJourney|JourneyCadence/,file);
 assert.deepEqual([...read('modules/prospecting/source-picker.tsx').matchAll(/value: "(\w+)",/g)].map(m=>m[1]),['MAPS','WEB','CNPJ','APOLLO']);
 const client=createProspectingClient({workspaceId:'qa',transport:async()=>Response.json({})});
 for(const key of ['prepareJourney','confirmJourney','prepareJourneyResume','resumeJourney','prepareJourneyCadence','confirmJourneyCadence'])assert.equal(key in client,false,key);
 for(const key of ['journey','journeyForJob','pauseJourney'])assert.equal(key in client,true,key);
 client.dispose();
});
