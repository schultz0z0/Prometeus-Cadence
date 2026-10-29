import {requirePrincipal} from '../auth/principal.ts';import {AppError,errorResponse} from '../errors.ts';import {readReport,readReportDetail} from './reports.ts';import type {ReportQuery} from '../../domain/reporting.ts';
export async function reportRequest(request:Request,id?:string){
 if(request.method!=='GET')return new Response(null,{status:405,headers:{allow:'GET','cache-control':'no-store'}});
 try{const p=await requirePrincipal(request.headers),expected=request.headers.get('x-cadence-workspace');if(expected&&expected!==p.workspaceId)throw new AppError(409,'O workspace mudou. Atualize o relatório.','WORKSPACE_CHANGED');
  const q=new URL(request.url).searchParams;if([...q.keys()].some(k=>!['view','from','to','timezone','cadenceId','cursor','metric'].includes(k))||[...new Set(q.keys())].some(k=>q.getAll(k).length!==1))throw new AppError(422,'Filtros de relatório inválidos.');
  const input=Object.fromEntries(q.entries()) as unknown as ReportQuery;const result=id?await readReportDetail(p,id,input):await readReport(p,input);return Response.json(result,{headers:{'cache-control':'no-store','x-report-checkpoint':result.checkpoint}});
 }catch(e){return errorResponse(e);}
}
