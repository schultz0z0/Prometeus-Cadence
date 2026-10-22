import 'server-only';
import {createHash} from 'node:crypto';
import {getPools} from '../db/pool.ts';
import {AppError} from '../errors.ts';
export async function unsubscribeMail(token:string,mode:'browser'|'one-click',input:unknown):Promise<void>{
 if(mode==='browser'){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!('confirm'in input)||input.confirm!==true)throw new AppError(422,'Confirme que deseja parar de receber mensagens.');}
 else if(input!=='List-Unsubscribe=One-Click')throw new AppError(422,'Formulário de descadastro inválido.');
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))return;
 await getPools().appPool.query('SELECT app.unsubscribe_mail_hash($1)',[createHash('sha256').update(token).digest('hex')]);
}
