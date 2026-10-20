export type Role='owner'|'admin'|'operator';
export interface Principal {userId:string;workspaceId:string;role:Role;sessionId:string}
