// Registers a campaign for a coupon the operator already created in Stripe.
//   node scripts/billing-coupon.mjs CODE stripe_coupon_id YYYY-MM-DD MAX_USES [--inactive] [--update]
// Releases a use held by an operation left uncertain, after checking in Stripe that no payable session exists:
//   node scripts/billing-coupon.mjs --release CODE WORKSPACE_ID
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
export async function saveCoupon(db,{code,stripeCoupon,validUntil,maxUses,active=true,update=false}){
 if(!/^[A-Z0-9_-]{3,40}$/.test(code))throw Error('O código precisa ter de 3 a 40 letras maiúsculas, números, _ ou -.');
 if(!/^[A-Za-z0-9_]{1,100}$/.test(stripeCoupon))throw Error('Id do cupom no Stripe inválido.');
 if(!(validUntil instanceof Date)||!Number.isFinite(+validUntil))throw Error('Validade inválida.');
 if(!Number.isInteger(maxUses)||maxUses<1)throw Error('Limite de usos inválido.');
 const saved=await db.query(`INSERT INTO app.billing_coupon(code,stripe_coupon_id,valid_until,max_uses,active) VALUES($1,$2,$3,$4,$5) ON CONFLICT(code) DO ${update?'UPDATE SET stripe_coupon_id=EXCLUDED.stripe_coupon_id,valid_until=EXCLUDED.valid_until,max_uses=EXCLUDED.max_uses,active=EXCLUDED.active':'NOTHING'}`,[code,stripeCoupon,validUntil,maxUses,active]);
 if(!saved.rowCount)throw Error('Este código já existe. Use --update para alterar a campanha.');
}
export const releaseCoupon=(db,code,workspaceId)=>db.query("DELETE FROM app.billing_coupon_claim WHERE code=$1 AND workspace_id=$2 AND state='claimed'",[code,workspaceId]);
/** The date is the last valid day, in Brazil. */
export function parseCouponArgs(argv){
 const [code,stripeCoupon,until,max,...flags]=argv;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(until??''))throw Error('Validade no formato AAAA-MM-DD.');
 const validUntil=new Date(until+'T23:59:59-03:00');if(!(+validUntil>Date.now()))throw Error('A validade já passou.');
 const unknown=flags.find(f=>!['--inactive','--update'].includes(f));if(unknown)throw Error('Opção desconhecida: '+unknown);
 const maxUses=Number(max);if(!Number.isInteger(maxUses)||maxUses<1)throw Error('Limite de usos inválido.');
 return {code,stripeCoupon,validUntil,maxUses,active:!flags.includes('--inactive'),update:flags.includes('--update')};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const argv=process.argv.slice(2);process.loadEnvFile('.env.local');
 const pool=new pg.Pool({connectionString:process.env.MIGRATOR_DATABASE_URL});
 try{
  if(argv[0]==='--release'){const r=await releaseCoupon(pool,argv[1],argv[2]);console.log(r.rowCount?'Uso liberado.':'Nada a liberar.');}
  else{const input=parseCouponArgs(argv);await saveCoupon(pool,input);console.log('Campanha registrada:',input.code);}
 }finally{await pool.end();}
}
