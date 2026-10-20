import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {AppError} from '../errors.ts';
export function canonical(value:unknown):string{
  if(value===undefined)return 'null';
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
}
export const hashValue=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export function createReviewToken(proof:unknown,secret:string,now=Date.now()){
  const payload=Buffer.from(JSON.stringify({hash:hashValue(proof),expiresAt:now+600000})).toString('base64url');
  return payload+'.'+createHmac('sha256',secret).update('cadence-prospecting-v1:'+payload).digest('hex');
}
export function verifyReviewToken(token:string,proof:unknown,secret:string,now=Date.now()){
  try{
    const [payload,sig,...extra]=token.split('.');
    if(extra.length||!payload||!sig||!/^[a-f0-9]{64}$/.test(sig))throw Error();
    const mac=createHmac('sha256',secret).update('cadence-prospecting-v1:'+payload).digest();
    if(!timingSafeEqual(mac,Buffer.from(sig,'hex')))throw Error();
    const data=JSON.parse(Buffer.from(payload,'base64url').toString());
    if(data.hash!==hashValue(proof)||!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=now||data.expiresAt>now+600000)throw Error();
    return data.expiresAt as number;
  }catch{throw new AppError(409,'A revisão mudou ou venceu. Revise o escopo novamente.','REVIEW_CHANGED');}
}
