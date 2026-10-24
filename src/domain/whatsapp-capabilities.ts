export interface WhatsappCapabilities {
 connectable:boolean;requiresServiceWindow:boolean;supportsOfficialTemplates:boolean;supportsText:boolean;
}
export function whatsappCapabilities(provider:string):WhatsappCapabilities {
 if(provider==='meta')return {connectable:true,requiresServiceWindow:true,supportsOfficialTemplates:true,supportsText:true};
 if(provider==='openwa')return {connectable:true,requiresServiceWindow:false,supportsOfficialTemplates:false,supportsText:true};
 return {connectable:false,requiresServiceWindow:true,supportsOfficialTemplates:false,supportsText:false};
}
