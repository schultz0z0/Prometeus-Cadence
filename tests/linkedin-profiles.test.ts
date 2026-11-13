import test from 'node:test';import assert from 'node:assert/strict';
import {parseLinkedinProfiles} from '../src/server/prospecting/providers/linkedin-profiles.ts';
import {linkedinDecisors} from '../src/domain/enrichment.ts';
const row=(o:Record<string,unknown>)=>({linkedinUrl:'https://www.linkedin.com/in/ana-silva-exemplo',firstName:'Ana',lastName:'Silva',headline:'Sócia na Empresa Exemplo',currentPosition:[{position:'Sócia-diretora',companyName:'Empresa Exemplo Ltda'}],emails:[{email:'ana@empresaexemplo.com.br',status:'valid',deliverable:true,catchAllDomain:false}],...o});
test('profile rows keep only a deliverable, non catch-all e-mail and a LinkedIn profile URL',()=>{
 const [ok,risky,bad]=parseLinkedinProfiles([row({}),row({linkedinUrl:'https://www.linkedin.com/in/ana-2',emails:[{email:'x@y.com',status:'risky',deliverable:false}]}),row({linkedinUrl:'https://evil.example/in/ana'})]);
 assert.deepEqual(ok,{url:'https://www.linkedin.com/in/ana-silva-exemplo',name:'Ana Silva',headline:'Sócia na Empresa Exemplo',positions:[{title:'Sócia-diretora',company:'Empresa Exemplo Ltda'}],email:'ana@empresaexemplo.com.br'});
 assert.equal(risky?.email,undefined);assert.equal(bad,undefined,'only linkedin.com/in profiles are accepted');
});
test('a profile becomes a decision maker only when the name matches a registry partner and the current company matches the lead',()=>{
 const partners=[{name:'ANA MARIA DA SILVA',role:'Sócio-Administrador'},{name:'JOSE PEREIRA',role:'Sócio'}];
 const profiles=parseLinkedinProfiles([row({}),row({linkedinUrl:'https://www.linkedin.com/in/ana-silva-outra',currentPosition:[{position:'Gerente',companyName:'Outra Companhia'}],headline:'Gerente'}),row({linkedinUrl:'https://www.linkedin.com/in/jose-p',firstName:'José',lastName:'Pereira',emails:[]})]).filter(p=>p!==undefined);
 const found=linkedinDecisors(partners,profiles,['EMPRESA EXEMPLO LTDA']);
 assert.deepEqual(found.map(f=>[f.partner.name,f.profile.url,f.role,f.profile.email??null]),[['ANA MARIA DA SILVA','https://www.linkedin.com/in/ana-silva-exemplo','Sócia-diretora','ana@empresaexemplo.com.br'],['JOSE PEREIRA','https://www.linkedin.com/in/jose-p','Sócia-diretora',null]],'the homonym at another company is dropped; a matching profile without e-mail still gives role and link');
});
test('the profile search uses first and last name in quotes and the short company name as keywords',async()=>{
 const {linkedinQuery}=await import('../src/domain/enrichment.ts');
 assert.equal(linkedinQuery('BRUNA RAFAELA DE ASSIS SILVA','SENSOR CORRETORA DE SEGUROS DE VIDA LTDA'),'"Bruna Silva" Sensor Corretora site:linkedin.com/in');
 assert.equal(linkedinQuery('Ana Silva','Empresa Exemplo'),'"Ana Silva" Exemplo site:linkedin.com/in');
});
test('a slow or failed profile read degrades to no profiles instead of blocking the enrichment',async()=>{
 const {readLinkedinProfiles}=await import('../src/server/prospecting/providers/linkedin-profiles.ts');
 Object.assign(process.env,{APIFY_LINKEDIN_ACTOR:'harvestapi/linkedin-profile-scraper',APIFY_LINKEDIN_BUILD:'fixture-build',APIFY_TOKEN:'fixture'});
 const signal=new AbortController().signal,url=['https://www.linkedin.com/in/ana'];
 assert.deepEqual(await readLinkedinProfiles(url,signal,async()=>{throw Error('network');}),[]);
 assert.deepEqual(await readLinkedinProfiles(url,signal,async()=>new Response('{}',{status:502})),[]);
 let waited=0;const slow:typeof fetch=async(_u,init)=>{const s=(init as RequestInit).signal!;await new Promise((_,reject)=>{s.addEventListener('abort',()=>{waited++;reject(Error('aborted'));});});return new Response('[]');};
 assert.deepEqual(await readLinkedinProfiles(url,signal,slow,50),[]);assert.equal(waited,1,'the read stops at its own deadline');
 assert.equal((await readLinkedinProfiles(url,signal,async()=>Response.json([{linkedinUrl:url[0],firstName:'Ana',lastName:'Silva',currentPosition:[]}]))).length,1);
});
test('only search hits naming the partner are worth reading',async()=>{
 const {mentionsPartner}=await import('../src/domain/enrichment.ts');
 assert.equal(mentionsPartner('https://www.linkedin.com/in/carlos-brasileiro-contabilidade-41a3b12b8 Carlos Brasileiro Contabilidade','CARLOS ALBERTO BRASILEIRO'),true);
 assert.equal(mentionsPartner('https://www.linkedin.com/in/luizmouraa Luiz Moura, PhD - Professor UFRJ','FABIO ALMEIDA BARBALHO'),false);
 assert.equal(mentionsPartner('https://www.linkedin.com/in/b%C3%A1rbara-amaro Bárbara Amaro','BARBARA SOUZA AMARO'),true);
});
