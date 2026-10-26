import { LEGAL_VERSION } from './legal-documents.ts';
export type RegistrationInput = {phone:string;accepted:boolean;termsVersion:string;privacyVersion:string};
export function validateRegistration(value: unknown) {
  if (!value || typeof value !== 'object') throw Error('Informe telefone e aceite os documentos para continuar.');
  const v=value as Partial<RegistrationInput>;
  if(v.accepted!==true || v.termsVersion!==LEGAL_VERSION || v.privacyVersion!==LEGAL_VERSION)
    throw Error('Leia e aceite as versões atuais dos Termos de Uso e da Política de Privacidade.');
  if(typeof v.phone!=='string' || !/^[+\d\s().-]{8,32}$/.test(v.phone)) throw Error('Informe um telefone válido com DDD ou código do país.');
  const digits=v.phone.replace(/\D/g,'');
  const phoneNumber=v.phone.trim().startsWith('+')?'+'+digits:(digits.length===10||digits.length===11)?'+55'+digits:'+'+digits;
  if(!/^\+[1-9]\d{7,14}$/.test(phoneNumber) || (/^\+55/.test(phoneNumber)&&!/^\+55[1-9]{2}[2-9]\d{7,8}$/.test(phoneNumber)))
    throw Error('Informe um telefone válido com DDD ou código do país.');
  return {phoneNumber,termsVersion:LEGAL_VERSION,privacyVersion:LEGAL_VERSION};
}
export function signupDestination(plan:unknown,mode:unknown) {
  return (plan==='essential'||plan==='pro')&&(mode==='subscribe'||(mode==='trial'&&plan==='essential'))
    ? '/onboarding/workspace?signupPlan='+plan+'&signupMode='+mode : '/onboarding/workspace';
}
// A small allowlist instead of arbitrary same-origin redirects (which could point at API actions).
export function entryDestination(value:unknown):string {
  if(typeof value!=='string'||value.length>500||!value.startsWith('/')||value.startsWith('//')||value.includes('\\'))return '/dashboard';
  try {
    const url=new URL(value,'http://entry.local');
    if(url.origin!=='http://entry.local'||url.hash)return '/dashboard';
    if(url.pathname==='/dashboard'&&!url.search)return '/dashboard';
    if(url.pathname==='/accept-invitation'&&[...url.searchParams.keys()].join()==='id'&&/^[\w-]{1,120}$/.test(url.searchParams.get('id')??''))return url.pathname+url.search;
    if(url.pathname==='/onboarding/workspace'&&[...url.searchParams.keys()].every(k=>['signupPlan','signupMode'].includes(k))) {
      if(!url.search)return url.pathname;
      const dest=signupDestination(url.searchParams.get('signupPlan'),url.searchParams.get('signupMode'));
      return dest==='/onboarding/workspace'?'/dashboard':dest;
    }
  }catch{}
  return '/dashboard';
}
