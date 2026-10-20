export type Role='owner'|'admin'|'operator';
export interface Principal {userId:string;workspaceId:string;role:Role;sessionId:string}
export type WorkspaceData=import('./model.ts').DemoState;
export interface WorkspaceSnapshot{workspaceId:string;revision:number;data:WorkspaceData;capabilities:string[]}
