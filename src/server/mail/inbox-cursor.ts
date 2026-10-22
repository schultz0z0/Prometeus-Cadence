import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {hashValue} from '../prospecting/review.ts';
import {AppError} from '../errors.ts';
const sign=(body:string)=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Cursor signing unavailable');return createHmac('sha256',process.env.BETTER_AUTH_SECRET).update('mail-inbox:'+body).digest();};
export function mailCursor(scope:unknown,value:string){const body=Buffer.from(JSON.stringify({scope:hashValue(scope),value})).toString('base64url');return body+'.'+sign(body).toString('base64url');}
export function readMailCursor(token:string|undefined,scope:unknown):string|null{
 if(!token)return null;try{if(token.length>2048)throw Error();const [body,signature,...extra]=token.split('.'),actual=Buffer.from(signature,'base64url'),expected=sign(body);if(extra.length||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error();const parsed=JSON.parse(Buffer.from(body,'base64url').toString());if(parsed.scope!==hashValue(scope)||typeof parsed.value!=='string'||parsed.value.length>120)throw Error();return parsed.value;}catch{throw new AppError(422,'A página não pertence a esta conversa ou filtro.');}
}
