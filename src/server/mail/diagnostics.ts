import 'server-only';
import {Resolver} from 'node:dns/promises';
import type {Principal} from '../../domain/workspace.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {requireChannelAdmin} from '../channels/repository.ts';
import {mailboxRow} from './repository.ts';
import {AppError} from '../errors.ts';
type Observation='observed'|'missing'|'unverified';
export async function diagnoseMailDomain(p:Principal,id:string,selector?:string,deps:{resolveTxt?:(name:string)=>Promise<string[][]>}={}):Promise<{spf:Observation;dkim:Observation;dmarc:Observation;alignment:'unverified';notes:string[]}>{
 if(selector!==undefined&&!/^[A-Za-z0-9_-]{1,63}$/.test(selector))throw new AppError(422,'Informe um seletor DKIM válido.');
 const box=await withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);return mailboxRow(c,id);}),domain=box.address?.split('@')[1];
 if(!domain)throw new AppError(409,'Conecte um endereço antes do diagnóstico.');
 const resolver=new Resolver({timeout:3000,tries:1}),resolve=deps.resolveTxt??(name=>resolver.resolveTxt(name));
 const observe=async(name:string,prefix:string):Promise<Observation>=>{try{const values=await resolve(name);return values.some(parts=>parts.join('').toLowerCase().startsWith(prefix))?'observed':'missing';}catch(error){return ['ENODATA','ENOTFOUND'].includes((error as {code?:string}).code??'')?'missing':'unverified';}};
 const [spf,dmarc,dkim]=await Promise.all([observe(domain,'v=spf1'),observe('_dmarc.'+domain,'v=dmarc1'),selector?observe(selector+'._domainkey.'+domain,'v=dkim1'):Promise.resolve<Observation>('unverified')]);
 return {spf,dkim,dmarc,alignment:'unverified',notes:['Registros DNS observados não comprovam autenticação, alinhamento ou entrega de uma mensagem.',...(selector?[]:['Informe o seletor publicado pelo provedor para consultar DKIM.'])]};
}
