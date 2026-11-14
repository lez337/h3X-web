import {useEffect,useRef,useState,type KeyboardEvent} from 'react';
import {Check,Copy,ExternalLink,LockKeyhole,Globe} from 'lucide-react';
import {requestJson} from './bridge';
import {cancelHostedReportDialog,type ReportCreation} from './share-events';

export default function ReportShareDialog(){
  const [creation,setCreation]=useState<ReportCreation|null>(null),[saved,setSaved]=useState(false),[active,setActive]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[copied,setCopied]=useState(''),[isPublic,setPublic]=useState(false);
  const copyButton=useRef<HTMLButtonElement>(null),previousFocus=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const show=(event:Event)=>{previousFocus.current=document.activeElement as HTMLElement;setCreation((event as CustomEvent<ReportCreation>).detail);setSaved(false);setActive(false);setBusy(false);setPublic(false);setMessage('');setCopied('')};
    window.addEventListener('h3x-report-created',show);
    return()=>{window.removeEventListener('h3x-report-created',show);cancelHostedReportDialog()};
  },[]);
  useEffect(()=>{if(creation)copyButton.current?.focus()},[creation]);
  if(!creation)return null;
  const report=creation.report;
  async function copy(value:string,kind:string){try{await navigator.clipboard.writeText(value);setCopied(kind);setMessage(kind==='code'?'Code copied.':'Link copied.')}catch{setMessage('Copy is unavailable. Select and copy the value shown below.')}}
  function close(created:boolean){creation!.finish(created);setCreation(null);previousFocus.current?.focus()}
  async function activate(){
    if((!isPublic&&!saved)||busy)return;setBusy(true);setMessage('');
    try{await requestJson(`/api/reports/${report.id}/activate`,{access:isPublic?'public':'protected',savedKey:!isPublic&&saved});setActive(true);setMessage(isPublic?'Your public link is ready. No code is required.':'Your link is ready. The code is required to open it.')}catch(error){setMessage((error as Error).message)}finally{setBusy(false)}
  }
  async function cancel(){
    if(busy)return;setBusy(true);try{await requestJson(`/api/reports/${report.id}/discard`,{});close(false)}catch(error){setMessage((error as Error).message)}finally{setBusy(false)}
  }
  function keys(event:KeyboardEvent<HTMLElement>){
    if(event.key==='Escape'){event.preventDefault();if(active&&!busy)close(true)}
    if(event.key==='Tab'){
      const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]'));
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    }
  }
  return <div className="modal-backdrop report-share-backdrop"><section className="report-share-dialog" role="dialog" aria-modal="true" aria-labelledby="report-share-title" aria-describedby="report-share-description" onKeyDown={keys}>
    <div className="eyebrow">{isPublic?<Globe size={14}/>:<LockKeyhole size={14}/>} {isPublic?'PUBLIC INVESTIGATION':'PROTECTED INVESTIGATION'}</div>
    <h2 id="report-share-title">{active?'Your investigation link is ready':isPublic?'Create a public link':'Save your access code'}</h2>
    {!active&&<div className="button-row report-access-options" role="group" aria-label="Report access"><button ref={copyButton} type="button" aria-pressed={!isPublic} disabled={busy} onClick={()=>{setPublic(false);setMessage('')}}><LockKeyhole size={15}/>Protected - code</button><button type="button" aria-pressed={isPublic} disabled={busy} onClick={()=>{setPublic(true);setMessage('')}}><Globe size={15}/>Public - no code</button></div>}
    <p id="report-share-description">{isPublic?'Anyone with this link can view the investigation immediately. No code or account is required.':'This code is shown only at creation. Save it before activating the link. Anyone opening the link must enter the code.'}</p>
    {!isPublic&&<><label htmlFor="report-code">Four-digit access code</label>
    <div className="report-code-row"><input id="report-code" className="report-created-code" readOnly value={report.code} onFocus={event=>event.currentTarget.select()}/><button onClick={()=>copy(report.code,'code')}>{copied==='code'?<Check size={16}/>:<Copy size={16}/>}Copy code</button></div>
    <label className="check report-key-saved"><input type="checkbox" checked={saved} disabled={busy||active} onChange={event=>setSaved(event.target.checked)}/>I saved the key</label></>}
    <label htmlFor="report-link">Investigation link</label><input id="report-link" readOnly value={report.url} onFocus={event=>event.currentTarget.select()} aria-describedby="report-link-state"/>
    <small id="report-link-state">{active?(isPublic?'Share this public link. No code is needed.':'Share the link and code with your intended recipient.'):(isPublic?'The link becomes public when you click Create public link.':'The link stays locked until you confirm and activate it.')}</small>
    {message&&<p role="status" className="report-share-message">{message}</p>}
    <div className="button-row report-share-actions">{active?<><button onClick={()=>copy(report.url,'link')}><Copy size={15}/>Copy link</button><a className="report-open-link" href={report.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>Open link</a><button className="primary" onClick={()=>close(true)}>Done</button></>:<><button disabled={busy} onClick={cancel}>Cancel</button><button className="primary" disabled={(!isPublic&&!saved)||busy} onClick={activate}>{busy?'Creating link...':isPublic?'Create public link':'Create link'}</button></>}</div>
  </section></div>;
}
