import type {Fetch} from './types.ts';
import {ProviderError} from './transport.ts';
// Operator decision of 2026-11-10: read LinkedIn profiles through a no-cookie Apify actor; risk recorded in docs/validation/2026-11-10-linkedin-scrapers-evaluation.md.
export const linkedinActor='harvestapi/linkedin-profile-scraper';
export interface LinkedinProfile{url:string;name:string;headline?:string;positions:{title:string;company:string}[];email?:string}
const text=(v:unknown,max=300)=>typeof v==='string'&&v.trim()?v.trim().slice(0,max):undefined;
export const linkedinProfileUrl=(value:unknown)=>{try{const u=new URL(String(value));return u.protocol==='https:'&&/(^|\.)linkedin\.com$/.test(u.hostname)&&/^\/in\/[^/]+\/?$/.test(u.pathname)?`https://www.linkedin.com${u.pathname.replace(/\/$/,'')}`:undefined;}catch{return undefined;}};
export function parseLinkedinProfiles(rows:unknown[]):(LinkedinProfile|undefined)[]{
 return rows.slice(0,10).map((raw)=>{
  const r=raw as Record<string,any>,url=linkedinProfileUrl(r?.linkedinUrl),name=[text(r?.firstName,100),text(r?.lastName,100)].filter(Boolean).join(' ');
  if(!url||!name)return undefined;
  const positions=(Array.isArray(r.currentPosition)?r.currentPosition:[]).slice(0,5).flatMap((p:any)=>text(p?.position)&&text(p?.companyName)?[{title:text(p.position)!,company:text(p.companyName)!}]:[]);
  // The provider infers the address and checks the mailbox; only a deliverable, non catch-all address is kept.
  const email=(Array.isArray(r.emails)?r.emails:[]).find((e:any)=>e?.status==='valid'&&e?.deliverable===true&&e?.catchAllDomain!==true&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e?.email??'')));
  return {url,name,...(text(r.headline)?{headline:text(r.headline)}:{}),positions,...(email?{email:String(email.email).toLowerCase()}:{})};
 });
}
// The actor needs well over the 30 s of the shared transport. LinkedIn is an optional complement: a slow, failed or lost read
// returns no profiles and the enrichment goes on. shortcut: a lost response may still be billed (capped by APIFY_LINKEDIN_MAX_CHARGE_USD); switch to start/poll if reads become frequent.
export async function readLinkedinProfiles(urls:string[],signal:AbortSignal,fetcher:Fetch=fetch,deadlineMs=125000):Promise<LinkedinProfile[]>{
 const build=process.env.APIFY_LINKEDIN_BUILD,token=process.env.APIFY_TOKEN,maxUsd=Number(process.env.APIFY_LINKEDIN_MAX_CHARGE_USD??'0.05');
 if(process.env.APIFY_LINKEDIN_ACTOR!==linkedinActor||!build||!/^[-\w.]{1,100}$/.test(build)||!token)throw new ProviderError('PROFILE_UNAVAILABLE');
 signal.throwIfAborted();
 try{
  const response=await fetcher(`https://api.apify.com/v2/acts/${linkedinActor.replace('/','~')}/run-sync-get-dataset-items?build=${encodeURIComponent(build)}&maxTotalChargeUsd=${maxUsd}&timeout=${Math.floor(deadlineMs/1000)-5}`,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({profileScraperMode:'Profile details + email search ($10 per 1k)',urls:urls.slice(0,4)}),signal:AbortSignal.any([signal,AbortSignal.timeout(deadlineMs)])});
  if(!response.ok)return [];
  const raw=await response.json();
  return Array.isArray(raw)?parseLinkedinProfiles(raw).filter((p):p is LinkedinProfile=>!!p):[];
 }catch(error){if(signal.aborted)throw error;return [];}
}
