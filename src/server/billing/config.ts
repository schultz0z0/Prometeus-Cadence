export function billingConfig(env:Record<string,string|undefined>=process.env){
 const key=env.STRIPE_SECRET_KEY??'',webhookSecret=env.STRIPE_WEBHOOK_SECRET??'';
 if(key&&!/^sk_test_[A-Za-z0-9_]+$/.test(key))throw Error('Somente chave Stripe de teste é permitida.');
 if(webhookSecret&&!/^whsec_[A-Za-z0-9_]+$/.test(webhookSecret))throw Error('Segredo de webhook inválido.');
 const url=new URL(env.BETTER_AUTH_URL??'http://127.0.0.1:3210');
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Origem de cobrança inválida.');
 if(url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('HTTPS necessário.');
 return {configured:!!key&&!!webhookSecret,key,webhookSecret,origin:url.origin,apiVersion:'2026-09-30.endive',mode:'test' as const};
}
