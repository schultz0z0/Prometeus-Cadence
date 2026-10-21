import type {CompanyProfile} from './model.ts';
export interface ProductProfile{name:string;offer:string;idealCustomer:string;differentiators:string;socialProof:string;sources:string}
export interface ApprovedProduct extends ProductProfile{version:number;approvedAt:string}
export interface ProductView{id:string;revision:number;draft:ProductProfile;approved:ApprovedProduct|null;archived:boolean}
export interface ContextState{draft:CompanyProfile;approved:CompanyProfile|null;products:ProductView[]}
