import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {fetchEvidencePack,fetchPublicPage} from '../src/server/prospecting/extraction/fetch-page.ts';

function browserFixture(t:TestContext,robots='User-agent: *\nDisallow: /privado'){
 const prior=process.env.SITE_BROWSER_TOKEN;
 process.env.SITE_BROWSER_TOKEN='fixture-site-browser-token-not-for-production';
 t.after(()=>{if(prior===undefined)delete process.env.SITE_BROWSER_TOKEN;else process.env.SITE_BROWSER_TOKEN=prior;});
 const seen:string[]=[];
 t.mock.method(globalThis,'fetch',async (input:unknown,init:RequestInit)=>{
  const endpoint=new URL(String(input));
  assert.equal(endpoint.origin,'http://127.0.0.1:3222');
  const {url}=JSON.parse(String(init.body));
  seen.push(endpoint.pathname+':'+new URL(url).pathname);
  if(endpoint.pathname==='/fetch')return Response.json({status:200,headers:{},body:Buffer.from(robots).toString('base64')});
  return Response.json({status:200,url,text:'[RE] Empresa do DOM',truncated:false,links:['https://example.com/contato'],contacts:['mailto:contato@example.com','tel:+554130136190'],externalLinks:['https://instagram.com/exemplo','https://www.linkedin.com/company/exemplo']});
 });
 return seen;
}

test('the shared site readers default to Chromium and retain public rendered contacts and links',async t=>{
 const seen=browserFixture(t);
 const pages=await fetchEvidencePack('https://example.com/',{signal:AbortSignal.timeout(3000)},true);
 assert.match(pages[0].text,/contato@example.com/);
 assert.match(pages[0].text,/\+554130136190/);
 assert.deepEqual(pages[0].socialLinks,['https://instagram.com/exemplo','https://www.linkedin.com/company/exemplo']);
 assert.deepEqual(seen,['/fetch:/robots.txt','/render:/','/render:/contato','/render:/sobre']);
});

test('the browser reader never requests a blocked path or a direct LinkedIn URL',async t=>{
 const seen=browserFixture(t);
 await assert.rejects(fetchPublicPage('https://example.com/privado',{signal:AbortSignal.timeout(3000)}),{code:'ROBOTS_DISALLOWED'});
 await assert.rejects(fetchPublicPage('https://www.linkedin.com/company/exemplo',{signal:AbortSignal.timeout(3000)}),{code:'URL_BLOCKED'});
 assert.deepEqual(seen,['/fetch:/robots.txt']);
});
