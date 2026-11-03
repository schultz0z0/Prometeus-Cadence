import {degreeOf,isPeopleSearchUrl,parsePostId,type AudienceSample,type CampaignSource} from '../../domain/linkedin-campaign.ts';
import {AppError} from '../errors.ts';
import {unipileRequest,type UnipileDeps} from './unipile.ts';
// The campaign's audience, read through the customer's account. A filter the provider cannot take is refused before any search.
export interface AudiencePerson{external:string;name:string;headline:string;company:string|null;location:string;profileUrl:string|null;degree:number|null;pending:boolean}
const unsupported=(message:string)=>new AppError(422,message,'LINKEDIN_FILTER_UNSUPPORTED');
const q=(account:string,extra:Record<string,string>={})=>'?'+new URLSearchParams({account_id:account,...extra}).toString();
async function parameterId(account:string,type:'LOCATION'|'INDUSTRY',label:string,deps:UnipileDeps){
 const r=await unipileRequest('GET','/api/v1/linkedin/search/parameters'+q(account,{type,keywords:label,limit:'10'}),undefined,deps);
 const items:{title?:string;id?:string}[]=Array.isArray(r?.items)?r.items:[];
 const hit=items.find(i=>i.title?.toLowerCase()===label.toLowerCase())??items[0];
 if(!hit?.id)throw unsupported(`${type==='LOCATION'?'Localização':'Setor'} "${label}" não encontrado no LinkedIn. Escolha outro termo.`);
 return String(hit.id);
}
export type AudienceQuery={kind:'search';body:Record<string,unknown>}|{kind:'post';postId:string};
/** Validates locally first (no call for an invalid link), then resolves locations and industries to LinkedIn ids. */
export async function audienceQuery(account:string,s:CampaignSource,deps:UnipileDeps):Promise<AudienceQuery>{
 if(s.mode==='url'){if(!isPeopleSearchUrl(s.searchUrl))throw unsupported('Cole o link de uma busca de pessoas do LinkedIn.');return {kind:'search',body:{url:s.searchUrl}};}
 if(s.mode==='post'){const postId=parsePostId(s.postUrl);if(!postId)throw unsupported('Cole o link de um post do LinkedIn.');return {kind:'post',postId};}
 if(!s.roles.length&&!s.locations.length&&!s.industries.length&&!s.keyword)throw unsupported('Preencha pelo menos um filtro antes de explorar.');
 const location=[],industry=[];
 for(const l of s.locations)location.push(await parameterId(account,'LOCATION',l,deps));
 for(const l of s.industries)industry.push(await parameterId(account,'INDUSTRY',l,deps));
 return {kind:'search',body:{api:'classic',category:'people',network_distance:s.degrees,...(s.keyword?{keywords:s.keyword}:{}),...(location.length?{location}:{}),
  ...(industry.length?{industry}:{}),...(s.roles.length?{advanced_keywords:{title:s.roles.join(' OR ')}}:{})}};
}
const text=(v:unknown,max:number)=>typeof v==='string'?v.slice(0,max):'';
function fromSearch(i:any):AudiencePerson|null{
 if(i?.type!=='PEOPLE'||typeof i.id!=='string'||!i.id)return null;
 return {external:i.id.slice(0,200),name:text(i.name,200)||'Perfil do LinkedIn',headline:text(i.headline,300),company:text(i.current_positions?.[0]?.company,200)||null,
  location:text(i.location,200),profileUrl:text(i.public_profile_url??i.profile_url,500)||null,degree:degreeOf(i.network_distance),pending:i.pending_invitation===true};
}
function fromAuthor(a:any):AudiencePerson|null{
 if(typeof a?.id!=='string'||!a.id)return null;
 return {external:a.id.slice(0,200),name:text(a.name,200)||'Perfil do LinkedIn',headline:text(a.headline,300),company:null,location:'',profileUrl:text(a.profile_url,500)||null,degree:degreeOf(a.network_distance),pending:false};
}
/** One page of the audience. The post cursor walks reactions, then comments. */
export async function audiencePage(account:string,query:AudienceQuery,cursor:string|null,deps:UnipileDeps):Promise<{people:AudiencePerson[];total:number|null;cursor:string|null}>{
 if(query.kind==='search'){
  const r=await unipileRequest('POST','/api/v1/linkedin/search'+q(account,cursor?{cursor,limit:'10'}:{limit:'10'}),query.body,deps);
  return {people:(Array.isArray(r?.items)?r.items:[]).map(fromSearch).filter(Boolean),total:Number.isFinite(r?.paging?.total_count)?r.paging.total_count:null,cursor:typeof r?.cursor==='string'&&r.cursor?r.cursor:null};
 }
 const post=await unipileRequest('GET','/api/v1/posts/'+encodeURIComponent(query.postId)+q(account),undefined,deps);
 const social=typeof post?.social_id==='string'?post.social_id:'urn:li:activity:'+query.postId,[phase,inner]=cursor?.split('|',2)??['reactions',''];
 const r=await unipileRequest('GET',`/api/v1/posts/${encodeURIComponent(social)}/${phase==='comments'?'comments':'reactions'}`+q(account,inner?{cursor:inner}:{}),undefined,deps);
 const next=typeof r?.cursor==='string'&&r.cursor?`${phase}|${r.cursor}`:phase==='comments'?null:'comments|';
 return {people:(Array.isArray(r?.items)?r.items:[]).map((i:any)=>fromAuthor(i?.author)).filter(Boolean),total:(Number(post?.reaction_counter)||0)+(Number(post?.comment_counter)||0),cursor:next};
}
export const sampleOf=(p:AudiencePerson):AudienceSample=>({name:p.name,headline:p.headline,location:p.location,degree:p.degree});
