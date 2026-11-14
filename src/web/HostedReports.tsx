import {useEffect,useRef,useState,type FormEvent,type KeyboardEvent} from 'react';
import {Copy,ExternalLink,Trash2} from 'lucide-react';
import {requestJson} from './bridge';

type Report={id:string;title:string;createdAt:string};
export default function HostedReports({onClose}:{onClose:()=>void}){
  const [reports,setReports]=useState<Report[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[link,setLink]=useState('');
  const closeButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement;closeButton.current?.focus();let canceled=false;
    requestJson('/api/reports').then(value=>{if(!canceled)setReports(value.reports)}).catch(error=>{if(!canceled)setMessage(error.message)}).finally(()=>{if(!canceled)setLoading(false)});
    return()=>{canceled=true;previous?.focus()};
  },[]);
  const url=(id:string)=>new URL('/reports/'+id,location.origin).href;
  async function remove(id:string,title:string){
    if(busy||!window.confirm(`Delete the HTML link for "${title}"? The link will stop working for everyone. Your saved investigation will remain.`))return;
    setBusy(true);setMessage('');
    try{await requestJson(`/api/reports/${id}/delete`,{});setReports(current=>current.filter(report=>report.id!==id));setLink('');setMessage('HTML link deleted. Your saved investigation is unchanged.')}catch(error){setMessage((error as Error).message)}finally{setBusy(false)}
  }
  async function deleteOlder(event:FormEvent){
    event.preventDefault();
    try{
      const parsed=new URL(link.trim(),location.origin),match=parsed.pathname.match(/^\/reports\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/);
      if(parsed.origin!==location.origin||!match)throw Error('Paste an investigation link from this website.');
      await remove(match[1],'pasted investigation');
    }catch(error){setMessage((error as Error).message)}
  }
  async function copy(id:string){try{await navigator.clipboard.writeText(url(id));setMessage('Link copied.')}catch{setMessage('Copy is unavailable. Copy the link from Open link.')}}
  function keys(event:KeyboardEvent<HTMLElement>){
    if(event.key==='Escape'&&!busy){event.preventDefault();onClose()}
    if(event.key==='Tab'){
      const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]')),first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    }
  }
  return <div className="modal-backdrop report-share-backdrop"><section className="report-share-dialog hosted-reports" role="dialog" aria-modal="true" aria-labelledby="hosted-reports-title" onKeyDown={keys}>
    <div className="editor-top"><h2 id="hosted-reports-title">My HTML links</h2><button ref={closeButton} disabled={busy} onClick={onClose}>Close</button></div>
    <p>Delete a hosted HTML export to stop sharing it. Your saved investigation stays in your account.</p>
    {loading?<p role="status">Loading links...</p>:reports.length===0?<p>No HTML links are listed for this account.</p>:<ul className="hosted-report-list">{reports.map(report=><li key={report.id}><strong>{report.title}</strong><small>{new Date(report.createdAt).toLocaleString()}</small><small className="hosted-report-id">{report.id}</small><div className="button-row report-share-actions"><a className="report-open-link" href={url(report.id)} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/>Open link</a><button disabled={busy} onClick={()=>copy(report.id)}><Copy size={14}/>Copy link</button><button disabled={busy} onClick={()=>remove(report.id,report.title)}><Trash2 size={14}/>Delete HTML</button></div></li>)}</ul>}
    <form onSubmit={deleteOlder}><label htmlFor="older-report-link">Delete an older HTML link</label><p>Links created before this update may not appear above. Paste the link here. Only its creator can delete it.</p><input id="older-report-link" type="url" placeholder={`${location.origin}/reports/...`} value={link} onChange={event=>setLink(event.target.value)} required disabled={busy}/><div className="report-share-actions"><button disabled={busy||!link.trim()} type="submit"><Trash2 size={14}/>{busy?'Deleting...':'Delete pasted link'}</button></div></form>
    {message&&<p role="status" className="report-share-message">{message}</p>}
  </section></div>;
}
