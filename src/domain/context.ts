import type {CompanyProfile} from './model.ts';
export function approveProfile(profile:CompanyProfile,now:string):CompanyProfile{return {...profile,version:profile.version+1,approvedAt:now};}
export function mergeProfileSuggestion(profile:CompanyProfile,suggestion:Partial<CompanyProfile>):CompanyProfile{return profile.approvedAt?{...profile}:{...suggestion,...profile};}
