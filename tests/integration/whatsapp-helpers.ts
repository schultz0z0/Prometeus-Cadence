import {randomUUID} from 'node:crypto';
import {prospectingUser,testAdmin} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
export {testAdmin};
export async function whatsappUser(){
 await resetRateLimits();
 process.env.CHANNEL_KEYRING_JSON=JSON.stringify({fixture:Buffer.alloc(32,12).toString('base64')});process.env.CHANNEL_ACTIVE_KEY_ID='fixture';
 return prospectingUser();
}
export function metaConnectionInput(){return {requestId:randomUUID(),expectedRevision:0,provider:'meta' as const,name:'QA Meta',identifiers:{appId:'123456',wabaId:'222222',phoneNumberId:'333333'},credentials:{accessToken:'fixture-access-token',appSecret:'fixture-app-secret'}};}
