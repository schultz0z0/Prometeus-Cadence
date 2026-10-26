export function currentContactsPage<T extends {revision:number}>(result:{key:string;data:T}|null,key:string,revision:number):T|null{
 return result?.key===key&&result.data.revision>=revision?result.data:null;
}
