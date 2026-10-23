export function mergeLiveItems<T extends {id:string}>(current:T[],fresh:T[]):T[]{const ids=new Set(fresh.map(item=>item.id));return [...fresh,...current.filter(item=>!ids.has(item.id))];}
