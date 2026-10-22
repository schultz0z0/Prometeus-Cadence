export {};
process.loadEnvFile('.env.local');
try{
 if(process.argv.slice(2).join(' ')!=='--prune'){console.log('Maintenance skipped. Use --prune to expire technical ingress metadata older than 90 days.');}
 else {const {pruneIngestMetadata}=await import('../src/server/channels/events.ts');let total=0;
  // Bounded work: at most ten batches of 1000 technical records per invocation.
  for(let i=0;i<10;i++){const count=await pruneIngestMetadata(new Date().toISOString());total+=count;if(count<1000)break;}
  const {pruneMailMetadata}=await import('../src/server/mail/maintenance.ts');let oauthAttempts=0,messages=0;
  for(let i=0;i<10;i++){const count=await pruneMailMetadata(new Date().toISOString());oauthAttempts+=count.oauthAttempts;messages+=count.messages;if(count.oauthAttempts<1000&&count.messages<1000)break;}
  console.log(JSON.stringify({ingressMetadata:total,emailMetadata:messages,expiredOAuthAttempts:oauthAttempts}));console.log('Conversation history, cursors, replay keys and audit retained.');
 }
}catch{console.error('Messaging maintenance failed. Check database availability and server configuration.');process.exitCode=1;}
finally{const {closeIngressPool}=await import('../src/server/channels/ingress-db.ts'),{closeDispatchPool}=await import('../src/server/messaging/worker-db.ts');await Promise.allSettled([closeIngressPool(),closeDispatchPool()]);}
