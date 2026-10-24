"use client";
import {useRef,useState} from 'react';
import type {Provider,ConnectionView} from '@/domain/whatsapp';
import type {ChannelClient} from '@/client/channel-client';
import {Button,Field,Notice} from '@/components/ui/primitives';
export function WhatsappConnectionForm({provider,connection,client,onSaved,onCancel}:{provider:Provider;connection?:ConnectionView;client:ChannelClient;onSaved:()=>Promise<void>;onCancel:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const formRef=useRef<HTMLFormElement>(null),pending=useRef<Parameters<ChannelClient['save']>[0]|null>(null);
 const identifiers=connection?.identifiers??{};
 const field=(label:string,name:string,secret=false,required=true)=><Field key={name} label={label} help={secret&&connection?'Deixe em branco para preservar o valor salvo.':undefined}><input name={name} defaultValue={secret?'':identifiers[name]??''} type={secret?'password':'text'} autoComplete={secret?'new-password':'off'} required={required&&(!secret||!connection)} maxLength={secret?16384:120} spellCheck={false}/></Field>;
 return <form ref={formRef} className="stack" autoComplete="off" onChange={()=>pending.current=null} onSubmit={async e=>{
  e.preventDefault();if(busy)return;setBusy(true);setError('');
  try{
   if(provider==='openwa')throw new Error('OpenWA usa conexão gerenciada por QR Code.');
   if(!pending.current){const data=new FormData(e.currentTarget),value=(key:string)=>String(data.get(key)??'').trim();
    const base={...(connection?{id:connection.id}:{}),expectedRevision:connection?.revision??0,name:value('name')};
    pending.current=provider==='meta'?{...base,provider,identifiers:{appId:value('appId'),wabaId:value('wabaId'),phoneNumberId:value('phoneNumberId')},credentials:{accessToken:value('accessToken'),appSecret:value('appSecret')}}:{...base,provider,identifiers:{accountSid:value('accountSid'),sender:value('sender'),authMode:value('authMode') as 'api-key'|'auth-token',...(value('messagingServiceSid')?{messagingServiceSid:value('messagingServiceSid')}:{})},credentials:{apiKeySid:value('apiKeySid'),apiKeySecret:value('apiKeySecret'),authToken:value('authToken')}};
   }
   await client.save(pending.current);pending.current=null;formRef.current?.reset();await onSaved();
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setBusy(false);}
 }}>
 <Notice>As credenciais são gravadas criptografadas no servidor. Salvar prepara a conexão; verificar e enviar um teste são ações separadas.</Notice>
 <Field label="Nome da conexão"><input name="name" defaultValue={connection?.name??(provider==='meta'?'WhatsApp Meta':'WhatsApp Twilio')} required maxLength={120}/></Field>
 <fieldset disabled={busy} className="channel-fields"><legend>Identificadores e credenciais</legend>
 {provider==='meta'?<>{field('App ID','appId')}{field('WABA ID · conta WhatsApp Business','wabaId')}{field('Phone Number ID · número remetente','phoneNumberId')}{field('Access token','accessToken',true)}{field('App secret','appSecret',true)}</>:<>
 {field('Account SID','accountSid')}{field('Remetente WhatsApp · +55…','sender')}
 <Field label="Autenticação de envio"><select name="authMode" defaultValue={identifiers.authMode??'api-key'}><option value="api-key">API Key + secret</option><option value="auth-token">Account SID + Auth Token</option></select></Field>
 {field('API Key SID · obrigatório no modo API Key','apiKeySid',true,false)}{field('API Key secret · obrigatório no modo API Key','apiKeySecret',true,false)}{field('Auth Token · valida os webhooks em ambos os modos','authToken',true)}{field('Messaging Service SID · opcional','messagingServiceSid',false,false)}
 </>}
 </fieldset>
 {error&&<p className="error-bar" role="alert">{error}</p>}
 <div className="form-actions"><Button type="button" disabled={busy} onClick={onCancel}>Cancelar</Button><Button variant="primary" disabled={busy}>{busy?'Salvando…':'Salvar conexão'}</Button></div>
 </form>;
}
