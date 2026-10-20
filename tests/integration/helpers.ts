import {randomUUID} from 'node:crypto';
import {getAuth,handleAuthRequest} from '../../src/server/auth/auth.ts';
import {getPools} from '../../src/server/db/pool.ts';
export const base=process.env.BETTER_AUTH_URL!;
export const password='Local-test-password-489!';
export const uniqueEmail=()=>`test-${randomUUID()}@cadence.example`;
export async function requestAuth(path:string,body?:unknown,cookie?:string){
 const headers=new Headers({origin:base});if(body)headers.set('content-type','application/json');if(cookie)headers.set('cookie',cookie);
 return handleAuthRequest(new Request(base+'/api/auth/'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}));
}
export function cookies(response:Response){return response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}
export async function mailLink(email:string,fragment:string){
 const response=await fetch(process.env.MAILHOG_URL+`/api/v2/search?kind=to&query=${encodeURIComponent(email)}`);
 const data=await response.json();
 for(const item of data.items??[]){const text=item.Content.Body.replace(/=\r?\n/g,'').replace(/=([A-Fa-f0-9]{2})/g,(_:string,h:string)=>String.fromCharCode(parseInt(h,16)));const links=text.match(/https?:\/\/[^\s<>]+/g)??[];const link=links.find((x:string)=>x.includes(fragment));if(link)return link;}
 throw Error('Expected local test email was not captured.');
}
export async function verifiedUser(){
 const email=uniqueEmail();const signup=await requestAuth('sign-up/email',{name:'Test User',email,password,callbackURL:base+'/onboarding/workspace'});if(!signup.ok)throw Error(`Test signup status ${signup.status}`);
 const link=await mailLink(email,'verify-email');const result=await handleAuthRequest(new Request(link));
 return {email,cookie:cookies(result),user:(await getAuth().api.getSession({headers:new Headers({cookie:cookies(result)})}))!.user};
}
export async function resetRateLimits(){await getPools().authPool.query('DELETE FROM "rateLimit"');}
