import test,{after} from 'node:test';import assert from 'node:assert/strict';
import {getPools} from '../../src/server/db/pool.ts';import {saveMailbox} from '../../src/server/mail/repository.ts';import {verifyMailbox} from '../../src/server/mail/connections.ts';
import {mailUser,smtpMailboxInput,testAdmin} from './mail-helpers.ts';import {mailTransports} from '../fixtures/mail-transports.ts';
after(async()=>getPools().close());
test('SMTP login verification does not claim an address or mark campaigns ready without inbox proof',async()=>{
 const u=await mailUser(),box=await saveMailbox(u.p,smtpMailboxInput()),f=await mailTransports();
 try{const verified=await verifyMailbox(u.p,box.id,1,f.deps);assert.equal(verified.sendVerified,true);assert.equal(verified.readVerified,true);assert.equal(verified.state,'verifying');assert.equal(verified.senderId,null);assert.equal(f.smtp.state.dataCount,0);
 const claims=await testAdmin(c=>c.query('SELECT * FROM app.email_address_ownership WHERE workspace_id=$1',[u.p.workspaceId]));assert.equal(claims.rowCount,0);
 }finally{await f.close();}
});
