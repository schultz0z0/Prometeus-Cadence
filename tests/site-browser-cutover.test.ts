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

function siteFixture(files:Record<string,{status:number;text?:string;redirect?:string;links?:string[]}>){
 const seen:string[]=[];
 const browser={async read(kind:string,url:string){
  const path=new URL(url).pathname;seen.push(kind+':'+path);
  const file=files[path]??{status:404};
  if(kind==='page')return {status:file.status,text:file.text??'Página '+path,links:file.links??[],finalUrl:url,truncated:false};
  return {status:file.status,text:file.text??'',redirect:file.redirect};
 }};
 return {browser,seen};
}

test('a site read follows the sitemap index, ranks services first and skips assets and other hosts',async()=>{
 const {browser,seen}=siteFixture({
  '/robots.txt':{status:200,text:'User-agent: *\nDisallow: /privado'},
  '/sitemap.xml':{status:301,redirect:'https://example.com/sitemap_index.xml'},
  '/sitemap_index.xml':{status:200,text:'<?xml version="1.0"?><sitemapindex><sitemap><loc>https://example.com/pages.xml</loc></sitemap></sitemapindex>'},
  '/pages.xml':{status:200,text:'<urlset>'+['/blog/post-1','/contato','/servicos/rastro','/arquivo.pdf','/privado/x','/servicos','/planos'].map(p=>'<url><loc>https://example.com'+p+'</loc></url>').join('')+'<url><loc>https://outro.com/servicos</loc></url></urlset>'},
  '/':{status:200,text:'Home '+'x'.repeat(20000),links:['https://example.com/sobre']},
  '/servicos':{status:200},'/servicos/rastro':{status:200},'/planos':{status:200},'/contato':{status:200},'/sobre':{status:500},'/blog/post-1':{status:200},
 });
 const pages=await fetchEvidencePack('https://example.com/',{signal:AbortSignal.timeout(3000),browser},true,{pages:12,chars:48000});
 assert.deepEqual(pages.map(p=>new URL(p.url).pathname),['/','/servicos','/planos','/servicos/rastro','/contato','/blog/post-1']);
 assert.ok(!seen.some(s=>/arquivo\.pdf|privado/.test(s)));
 assert.ok(pages.reduce((n,p)=>n+p.text.length,0)<=48000);
 assert.ok(pages.every(p=>p.text.length<=12000));
});

test('without a sitemap a site read ranks the home links and stops at the page budget',async()=>{
 const links=['/sobre','/blog/a','/produtos/x','/precos',...Array.from({length:20},(_,i)=>'/p'+i)].map(p=>'https://example.com'+p);
 const {browser}=siteFixture({'/robots.txt':{status:404},'/':{status:200,links},...Object.fromEntries(links.map(l=>[new URL(l).pathname,{status:200}]))});
 const pages=await fetchEvidencePack('https://example.com/',{signal:AbortSignal.timeout(3000),browser},true,{pages:12,chars:48000});
 assert.equal(pages.length,12);
 assert.deepEqual(pages.slice(0,4).map(p=>new URL(p.url).pathname),['/','/precos','/produtos/x','/sobre']);
});

test('a site read retries a timed-out page once and still uses the sitemap when the home keeps failing',async()=>{
 const {ProviderError}=await import('../src/server/prospecting/providers/transport.ts');
 const failures:Record<string,number>={'/servicos':1,'/':2};
 const {browser,seen}=siteFixture({'/robots.txt':{status:404},'/sitemap.xml':{status:200,text:'<urlset><url><loc>https://example.com/servicos</loc></url><url><loc>https://example.com/contato</loc></url></urlset>'},'/servicos':{status:200},'/contato':{status:200}});
 const flaky={read:async(kind:string,url:string)=>{const path=new URL(url).pathname;if(kind==='page'&&failures[path]){failures[path]--;seen.push('timeout:'+path);throw new ProviderError('PAGE_TIMEOUT',504);}return browser.read(kind,url);}};
 const pages=await fetchEvidencePack('https://example.com/',{signal:AbortSignal.timeout(3000),browser:flaky},true,{pages:12,chars:48000});
 assert.deepEqual(pages.map(p=>new URL(p.url).pathname),['/servicos','/contato']);
 assert.equal(seen.filter(s=>s==='timeout:/').length,2);
});
