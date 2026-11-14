export type HostedReport={id:string;url:string;code:string;active:boolean};
export type ReportCreation={report:HostedReport;finish:(created:boolean)=>void};
let pending:((created:boolean)=>void)|undefined;
export function presentHostedReport(report:HostedReport):Promise<boolean>{
  return new Promise(resolve=>{
    pending=resolve;
    window.dispatchEvent(new CustomEvent<ReportCreation>('h3x-report-created',{detail:{report,finish:created=>{pending=undefined;resolve(created)}}}));
  });
}
export function cancelHostedReportDialog(){pending?.(false);pending=undefined;}
