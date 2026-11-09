export function siteUrl(value:string, root?:string) {
  try {
    const url = new URL(value,root);
    if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (/(^|\.)(linkedin\.com|licdn\.com|unipile\.com)$/i.test(url.hostname.replace(/\.$/,'')))return null;
    if (root) {
      const origin=new URL(root);
      if (url.hostname.replace(/^www\./,'')!==origin.hostname.replace(/^www\./,'') ||
          (origin.protocol==='https:' && url.protocol!=='https:')) return null;
    }
    url.hash='';
    return url.href.length<=1800 ? url.href : null;
  } catch {return null;}
}

type Rule={allow:boolean; pattern:string};
const normalized=(value:string)=>encodeURI(value).replace(/%25([\dA-F]{2})/gi,(_,hex:string)=>{
  const char=String.fromCharCode(parseInt(hex,16));
  return /[\w.~-]/.test(char)?char:'%'+hex.toUpperCase();
});

export function parseRobots(text:string) {
  const groups:{agents:string[]; rules:Rule[]}[]=[];
  const sitemaps:string[]=[];
  let group:typeof groups[number]|undefined;
  let afterRules=false;
  for (const line of text.split(/\r?\n/)) {
    const [,raw='',value='']=line.split('#',1)[0].match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/)??[];
    const field=raw.toLowerCase();
    if (field==='sitemap'&&value)sitemaps.push(value);
    if (field==='user-agent') {
      if(!group||afterRules){group={agents:[],rules:[]};groups.push(group);afterRules=false;}
      group.agents.push(value.toLowerCase());
    }
    if (group&&(field==='allow'||field==='disallow')) {
      afterRules=true;
      if(value.startsWith('/'))group.rules.push({allow:field==='allow',pattern:normalized(value)});
    }
  }
  const exact=groups.filter(item=>item.agents.includes('prometeuscadence'));
  const chosen=exact.length?exact:groups.filter(item=>item.agents.includes('*'));
  return {rules:chosen.flatMap(item=>item.rules),sitemaps};
}

// Match in linear passes over path segments. A remote robots.txt cannot inject a regular expression.
function matches(path:string,pattern:string) {
  const anchored=pattern.endsWith('$');
  const [prefix,...middle]=(anchored?pattern.slice(0,-1):pattern).split('*');
  if (!path.startsWith(prefix))return false;
  if (!middle.length)return !anchored||path===prefix;
  const suffix=anchored?middle.pop()!:'';
  if (!path.endsWith(suffix))return false;
  const body=path.slice(prefix.length,path.length-suffix.length);
  let offset=0;
  for (const part of middle) {
    const found=body.indexOf(part,offset);
    if (found<0)return false;
    offset=found+part.length;
  }
  return path.length>=prefix.length+suffix.length+offset;
}

export function allows(url:string,rules:Rule[]) {
  const {pathname,search}=new URL(url), path=normalized(pathname+search);
  let best:Rule|undefined;
  for (const rule of rules) {
    if (best && (rule.pattern.length<best.pattern.length ||
        (rule.pattern.length===best.pattern.length&&best.allow)))continue;
    if (matches(path,rule.pattern))best=rule;
  }
  return best?.allow??true;
}

export const siteRedirectStatuses=[301,302,303,307,308];
