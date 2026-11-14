import {useEffect,useState,type FormEvent} from 'react';
import {LockKeyhole,ArrowRight,Download,Upload,Cloud,UserRound,Copy,Check} from 'lucide-react';
import App from '../App';
import {clearSessionKeys,requestJson} from './bridge';
import {loadWorkspace,saveWorkspace,openWorkspace,closeWorkspace,legacyWorkspace,syncStatus,accountId,refreshWorkspace,type SyncStatus} from './storage';
import InstallApp from './InstallApp';
import {download,pickFiles} from './files';
import {validateState} from './state.mjs';
import ReportShareDialog from './ReportShareDialog';
import SharedInvestigation from './SharedInvestigation';
import HostedReports from './HostedReports';
import AccountMenu from './AccountMenu';

export function WebWorkspace(){
  const [message,setMessage]=useState('');
  async function backup(){try{download(JSON.stringify(await loadWorkspace(),null,2),'H3X-workspace.json','application/json');setMessage('Workspace backup downloaded.')}catch(error){setMessage((error as Error).message)}}
  async function replace(state:any){
    if(!window.confirm('Replace this account’s workspace? Download a backup first to keep your current investigations.'))return;
    await saveWorkspace(state);location.reload();
  }
  async function restore(){try{
    const [file]=await pickFiles('.json');if(!file)return;if(file.size>8*1024*1024)throw Error('Workspace exceeds 8 MB.');
    await replace(validateState(JSON.parse(await file.text())));
  }catch(error){setMessage((error as Error).message)}}
  async function importBrowser(){try{
    const state=await legacyWorkspace();if(!state){setMessage('No previous browser workspace was found on this device.');return;}await replace(state);
  }catch(error){setMessage((error as Error).message)}}
  return <section className="panel web-workspace"><div className="eyebrow">H3X V2 WEB</div><h2>Account workspace</h2><p>Investigations, graph, pins, settings and search history save automatically to your account. Sign in with the same name and 8-digit key on another device to reopen them. Changes from another device appear automatically while this workspace has no unsaved edits.</p><p>Provider keys stay in memory until you sign out, close or refresh this page. Activity logs stay in this browser, separately for each account.</p><InstallApp/><div className="button-row"><button onClick={backup}><Download size={15}/>Download backup</button><button onClick={restore}><Upload size={15}/>Restore backup</button><button onClick={importBrowser}>Import previous browser workspace</button></div>{message&&<p role="status">{message}</p>}</section>;
}
function WorkspaceApp(){
  useEffect(()=>{
    let running=false;
    const refresh=async()=>{if(running||document.visibilityState==='hidden')return;running=true;try{await refreshWorkspace()}catch{/* Saving remains authoritative; retry on the next poll. */}finally{running=false}};
    const timer=setInterval(refresh,10000);window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh)};
  },[]);
  const [showReports,setShowReports]=useState(false);
  const [ready,setReady]=useState(false),[account,setAccount]=useState<{id:string;name:string}|null>(null),[name,setName]=useState(''),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [mode,setMode]=useState<'login'|'create'>('login'),[created,setCreated]=useState<{name:string;key:string}|null>(null),[saved,setSaved]=useState(false),[copied,setCopied]=useState(false),[sync,setSync]=useState<SyncStatus>(syncStatus);
  useEffect(()=>{
    let canceled=false;
    requestJson('/api/session').then(async value=>{if(canceled||!value.authenticated)return;await openWorkspace(value.account.id);if(!canceled)setAccount(value.account)}).catch(error=>{if(!canceled)setError(error.message)}).finally(()=>{if(!canceled)setReady(true)});
    const expired=()=>{clearSessionKeys();closeWorkspace();setAccount(null);setError('Your session ended or the account changed. Sign in again.');};
    const status=(event:Event)=>setSync((event as CustomEvent<SyncStatus>).detail);
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(accountId()&&syncStatus().status!=='saved'){event.preventDefault();event.returnValue='';}};
    window.addEventListener('h3x-auth-required',expired);window.addEventListener('h3x-sync-status',status);window.addEventListener('beforeunload',beforeUnload);
    return()=>{canceled=true;window.removeEventListener('h3x-auth-required',expired);window.removeEventListener('h3x-sync-status',status);window.removeEventListener('beforeunload',beforeUnload)};
  },[]);
  async function signIn(loginName:string,loginKey:string){const value=await requestJson('/api/login',{name:loginName,key:loginKey});await openWorkspace(value.account.id);setName(value.account.name);setMode('login');setKey('');setCreated(null);setAccount(value.account)}
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{
    if(mode==='create'){const value=await requestJson('/api/accounts',{name});setCreated({name:value.account.name,key:value.key});setSaved(false);setCopied(false)}
    else await signIn(name,key);
  }catch(error){setError((error as Error).message)}finally{setBusy(false)}}
  async function continueCreated(){if(!created||!saved)return;setBusy(true);setError('');try{await signIn(created.name,created.key)}catch(error){setError((error as Error).message)}finally{setBusy(false)}}
  async function copyKey(){try{await navigator.clipboard.writeText(created!.key);setCopied(true)}catch{setError('Copy is unavailable. Select the key and save it manually.')}}
  async function logout(){setBusy(true);setError('');try{
    const pending:Promise<unknown>[]=[];window.dispatchEvent(new CustomEvent('h3x-save-now',{detail:pending}));await Promise.all(pending);
    await requestJson('/api/logout',{});clearSessionKeys();closeWorkspace();setAccount(null);
  }catch(error){setError((error as Error).message)}finally{setBusy(false)}}
  if(account)return <><App/><ReportShareDialog/>{showReports&&<HostedReports onClose={()=>setShowReports(false)}/>}<AccountMenu account={account} sync={sync} busy={busy} onLogout={logout} onReports={()=>setShowReports(true)}/>{(error||sync.status==='error')&&<div className="web-account-error" role="alert">{error||sync.message}<button onClick={async()=>download(JSON.stringify(await loadWorkspace(),null,2),'H3X-unsaved-workspace.json','application/json')}><Download size={14}/>Download backup</button></div>}</>;
  return <main className="web-login"><section className="web-login-card"><div className="web-login-brand">H<span>3</span>X <small>V2 / WEB</small></div><div className="eyebrow"><Cloud size={14}/>YOUR INVESTIGATION WORKSPACE</div>
    {created?<div className="web-created-account"><h1>Save your<br/>account key.</h1><p>Account created for <strong>{created.name}</strong>. Your 8-digit key is shown once. Keep it safe: you need your name and this key to log in.</p><label htmlFor="created-account-key">Your 8-digit account key</label><div className="report-code-row"><input id="created-account-key" className="web-created-key" readOnly value={created.key} onFocus={event=>event.currentTarget.select()}/><button onClick={copyKey}>{copied?<Check size={15}/>:<Copy size={15}/>}<span>{copied?'Copied':'Copy key'}</span></button></div><p className="web-key-note">There is no key recovery. Save it before continuing.</p><label className="web-saved-key"><input type="checkbox" checked={saved} onChange={event=>setSaved(event.target.checked)}/>I saved the key</label><button className="primary web-account-continue" disabled={!saved||busy} onClick={continueCreated}>{busy?'Opening workspace…':'Open my account'}<ArrowRight size={17}/></button></div>:<><h1>Your investigations.<br/>Saved to your account.</h1><p>Choose a name, save your key, and pick up your investigations on any device.</p><div className="web-auth-tabs" role="group" aria-label="Account access"><button aria-pressed={mode==='login'} disabled={busy} onClick={()=>{setMode('login');setError('')}}>Log in</button><button aria-pressed={mode==='create'} disabled={busy} onClick={()=>{setMode('create');setKey('');setError('')}}>Create an account</button></div><form onSubmit={submit}><label htmlFor="account-name">Account name</label><div className="web-key-input"><UserRound size={17}/><input id="account-name" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={32} pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,31}" value={name} onChange={event=>setName(event.target.value)} placeholder="Username" required disabled={!ready||busy} aria-describedby="account-name-hint"/></div><small id="account-name-hint" className="web-name-hint">3–32 letters, numbers, dots, underscores or hyphens.</small>{mode==='login'?<><label htmlFor="account-key">8-digit account key</label><div className="web-key-input"><LockKeyhole size={17}/><input id="account-key" type="password" inputMode="numeric" pattern="[0-9]{8}" minLength={8} maxLength={8} autoComplete="current-password" value={key} onChange={event=>setKey(event.target.value)} placeholder="Enter your 8-digit key" required disabled={!ready||busy}/></div></>:<p className="web-key-note">We’ll generate your 8-digit key when you create the account.</p>}<button className="primary" disabled={!ready||busy||name.trim().length<3||(mode==='login'&&!/^\d{8}$/.test(key))}>{!ready?'Connecting…':busy?(mode==='create'?'Creating account…':'Signing in…'):mode==='create'?'Create account':'Log in'}<ArrowRight size={17}/></button></form></>}
    {error&&<p className="web-login-error" role="alert">{error}</p>}<div className="web-login-foot">Investigations save automatically to your account.<br/>Shared report links use their own separate 4-digit code.</div></section><span className="web-login-version">H3X SEARCHER / 0.2.9</span></main>;
}
export default function WebApp(){
  const match=window.location.pathname.match(/^\/reports\/([0-9a-f-]{36})\/?$/);
  return match?<SharedInvestigation id={match[1]}/>:<WorkspaceApp/>;
}
