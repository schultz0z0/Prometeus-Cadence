export function workspaceTag(workspaceId:string,revision:number,capabilities:string[]){return '"'+encodeURIComponent(JSON.stringify([workspaceId,revision,[...capabilities].sort()]))+'"';}
