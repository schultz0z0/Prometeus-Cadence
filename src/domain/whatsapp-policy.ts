import type {SendPolicyInput,SendPolicyResult} from './whatsapp.ts';
export function evaluateSendPolicy(input:SendPolicyInput):SendPolicyResult {
 const blockers:string[]=[];
 const now=Date.parse(input.now),inbound=input.lastInboundAt?Date.parse(input.lastInboundAt):NaN;
 const open=Number.isFinite(now)&&Number.isFinite(inbound)&&inbound<=now&&now-inbound<86400000;
 if(!Number.isFinite(now))blockers.push('INVALID_CLOCK');
 if(!input.senderReady)blockers.push('SENDER_UNAVAILABLE');
 if(input.suppressed)blockers.push('CONTACT_SUPPRESSED');
 if((input.purpose!=='service'||!open)&&!input.hasOptIn)blockers.push('OPT_IN_REQUIRED');
 if(input.content.kind==='text'){
  if(!open)blockers.push('SERVICE_WINDOW_CLOSED');
  if(!input.content.text.trim()||input.content.text.length>4096||/\{\{[^{}]*\}\}/.test(input.content.text))blockers.push('INVALID_TEXT');
 }else{
  const template=input.template,content=input.content;
  if(!template||template.id!==content.templateId||template.revision!==content.templateRevision||template.status!=='approved')blockers.push('TEMPLATE_UNAVAILABLE');
  if(template){
   const keys=template.parameters.map(p=>p.key),provided=Object.keys(content.variables);
   if(new Set(keys).size!==keys.length||keys.length!==provided.length||keys.some(key=>!Object.hasOwn(content.variables,key))||provided.some(key=>!keys.includes(key)))blockers.push('TEMPLATE_PARAMETERS_MISMATCH');
   if(template.parameters.some(p=>p.type!=='text'))blockers.push('TEMPLATE_PARAMETER_UNSUPPORTED');
   if(provided.some(key=>typeof content.variables[key]!=='string'||!content.variables[key].trim()||content.variables[key].length>1024||/\{\{[^{}]*\}\}/.test(content.variables[key])))blockers.push('TEMPLATE_VARIABLE_INVALID');
  }
 }
 return {allowed:blockers.length===0,blockers};
}
