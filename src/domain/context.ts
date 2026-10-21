import type { CompanyProfile } from "./model.ts";
import {contextFields,type ContextField,type SupportedField} from './planning.ts';
export function mergeContextFields(base:CompanyProfile,suggestion:Partial<Record<ContextField,SupportedField>>,current:CompanyProfile,selectedFields:ContextField[]):{draft:CompanyProfile;conflicts:ContextField[]}{
 const draft={...current},conflicts:ContextField[]=[];let changed=false;
 for(const field of new Set(selectedFields)){
  if(!contextFields.includes(field)||!suggestion[field])continue;
  const value=suggestion[field]!.value;
  if(current[field]!==base[field]&&current[field]!==value){conflicts.push(field);continue;}
  if(current[field]!==value){draft[field]=value;changed=true;}
 }
 if(changed)draft.approvedAt=null;
 return {draft,conflicts};
}
export function approveProfile(
  profile: CompanyProfile,
  now: string,
): CompanyProfile {
  return { ...profile, version: profile.version + 1, approvedAt: now };
}
export function mergeProfileSuggestion(
  profile: CompanyProfile,
  suggestion: Partial<CompanyProfile>,
): CompanyProfile {
  return profile.approvedAt ? { ...profile } : { ...suggestion, ...profile };
}
