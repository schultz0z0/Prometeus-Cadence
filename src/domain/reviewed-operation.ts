export interface Reviewed<T>{input:T;token:string;expiresAt:string;blockers:string[];warnings:string[];basisHash:string}
export interface Confirm<T>{input:T;token:string;requestId:string}
export interface EvidenceRef{id:string;url:string;fetchedAt:string;quote:string;hash:string;sourceVersion:string}
