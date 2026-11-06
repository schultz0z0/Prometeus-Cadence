import type {ReportMetric,ReportQuery,ReportView} from '../domain/reporting.ts';
import type {ExecutionDiaryPage} from '../domain/execution-diary.ts';
import {createWorkspaceTransport,type WorkspaceTransportOptions} from './workspace-transport.ts';
export function createReportClient(options:WorkspaceTransportOptions){
 const api=createWorkspaceTransport(options);
 const query=(input:ReportQuery)=>new URLSearchParams(Object.entries(input).filter(([,v])=>v!==undefined) as [string,string][]).toString();
 return{read:(input:ReportQuery)=>api.request<ReportView>('/api/reports?'+query(input)),detail:(metric:ReportMetric,input:ReportQuery)=>api.request<ReportView>('/api/reports/'+metric+'?'+query(input)),executionDiary:(query:string)=>api.request<ExecutionDiaryPage>('/api/execution-diary?'+query),dispose:api.dispose};
}
export type ReportClient=ReturnType<typeof createReportClient>;
