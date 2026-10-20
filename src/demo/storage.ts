import type {DemoState} from '../domain/model.ts';
import {createSeed} from './seed.ts';
export const STORAGE_KEY='prometeus-cadence-demo-v1';
export function decodeDemoState(raw:string|null):{ok:true;value:DemoState}|{ok:false;reason:string}{
 if(raw===null)return {ok:true,value:createSeed()};
 try{const s=JSON.parse(raw);if(s?.schemaVersion!==1)return {ok:false,reason:'A versão dos dados locais não é compatível.'};const arrays=['lists','leads','automations','cadences','templates','jobs'];if(!arrays.every(k=>Array.isArray(s[k]))||!s.companyProfile||!s.preferences||!s.confirmationResults)return {ok:false,reason:'Os dados locais estão incompletos.'};
 if(s.lists.some((l:unknown)=>!l||typeof l!=='object'||!('id'in l)||!('name'in l)))throw Error();
 if(s.leads.some((l:unknown)=>!l||typeof l!=='object'||!('name'in l)||typeof l.name!=='string'||!('id'in l)))throw Error();
 if(s.cadences.some((c:unknown)=>!c||typeof c!=='object'||!('steps'in c)||!Array.isArray(c.steps)||!('settings'in c)))throw Error();
 return {ok:true,value:s};}catch{return {ok:false,reason:'Não foi possível ler os dados salvos neste navegador.'};}
}
