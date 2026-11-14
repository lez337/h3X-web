import {useEffect,useState,type FormEvent} from 'react';
import {ArrowRight,LockKeyhole,ShieldCheck} from 'lucide-react';

export default function SharedInvestigation({id}:{id:string}){
  const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reportUrl,setReportUrl]=useState('');
  const [loading,setLoading]=useState(true),[isPublic,setPublic]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setPublic(false);setReportUrl('');setError('');setCode('');
    fetch(`/api/reports/${id}/access`,{credentials:'same-origin',signal:controller.signal}).then(async response=>{
      const result=await response.json();if(!response.ok)throw Error(result.error||'Could not open the investigation.');
      if(controller.signal.aborted)return;
      if(result.public===true){if(result.url!==`/api/reports/${id}/content`)throw Error('Invalid report response.');setPublic(true);setReportUrl(result.url)}
    }).catch(error=>{if(!controller.signal.aborted)setError(error.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[id]);
  async function unlock(event:FormEvent){
    event.preventDefault();if(!/^\d{4}$/.test(code)||busy)return;setBusy(true);setError('');
    try{
      const response=await fetch(`/api/reports/${id}/unlock`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Could not open the investigation.');
      if(result.url!==`/api/reports/${id}/content`)throw Error('Invalid report response.');
      setCode('');setReportUrl(result.url);
    }catch(error){setError((error as Error).message)}finally{setBusy(false)}
  }
  async function lock(){setBusy(true);try{const response=await fetch(`/api/reports/${id}/lock`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw Error('Could not lock the view. Please try again.');setReportUrl('');setError('')}catch(error){setError((error as Error).message)}finally{setBusy(false)}}
  if(loading)return <main className="web-login"><p role="status">Opening shared investigation...</p></main>;
  if(reportUrl)return <main className="shared-report-view"><header><span>H3X / {isPublic?'PUBLIC INVESTIGATION':'INVESTIGATION'}</span>{!isPublic&&<button disabled={busy} onClick={lock}><LockKeyhole size={14}/>Lock view</button>}</header>{error&&<p role="alert">{error}</p>}<iframe title="Shared investigation" src={reportUrl} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"/></main>;
  return <main className="web-login"><section className="web-login-card"><div className="web-login-brand">H<span>3</span>X <small>SHARED REPORT</small></div><div className="eyebrow"><ShieldCheck size={14}/>PROTECTED INVESTIGATION</div><h1>Enter the code<br/>to open this file.</h1><p>Use the four-digit code provided by the person who shared this investigation.</p><form onSubmit={unlock}><label htmlFor="shared-report-code">Access code</label><div className="web-key-input"><LockKeyhole size={17}/><input id="shared-report-code" className="report-unlock-code" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4}" maxLength={4} value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,''))} placeholder="0000" required autoFocus disabled={busy}/></div><button className="primary" disabled={busy||code.length!==4}>{busy?'Opening…':'Open investigation'}<ArrowRight size={17}/></button>{error&&<p className="web-login-error" role="alert">{error}</p>}</form><div className="web-login-foot">Only the correct code opens the investigation.</div></section></main>;
}
