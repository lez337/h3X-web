import {useEffect,useState,type FormEvent} from 'react';
import {LockKeyhole,ArrowRight,LogOut,Download,Upload,Cloud} from 'lucide-react';
import App from '../App';
import {clearSessionKeys,requestJson} from './bridge';
import {loadWorkspace,saveWorkspace,log} from './storage';
import {download,pickFiles} from './files';
import {validateState} from './state.mjs';

export function WebWorkspace(){
  const [message,setMessage]=useState('');
  async function backup(){try{download(JSON.stringify(await loadWorkspace(),null,2),'H3X-workspace.json','application/json');setMessage('Workspace backup downloaded.')}catch(error){setMessage((error as Error).message)}}
  async function restore(){try{
    const [file]=await pickFiles('.json');if(!file)return;if(file.size>8*1024*1024)throw Error('Workspace exceeds 8 MB.');
    const state=validateState(JSON.parse(await file.text()));
    if(!window.confirm('Replace this browser’s workspace with the selected backup? Download a backup first if you need to keep the current workspace.'))return;
    await saveWorkspace(state);location.reload();
  }catch(error){setMessage((error as Error).message)}}
  return <section className="panel web-workspace"><div className="eyebrow">H3X V2 WEB</div><h2>Browser workspace</h2><p>Investigations, graph, pins, settings and history are saved in this browser on this device. Download a backup to move your workspace or preserve it before clearing browser data.</p><p>Provider keys stay in memory until you sign out, close or refresh this page. They are sent to this site’s Worker only for lookups. Keys configured on the Worker remain available after refresh.</p><div className="button-row"><button onClick={backup}><Download size={15}/>Download backup</button><button onClick={restore}><Upload size={15}/>Restore backup</button></div>{message&&<p role="status">{message}</p>}</section>;
}
export default function WebApp(){
  const [ready,setReady]=useState(false),[authenticated,setAuthenticated]=useState(false),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    requestJson('/api/session').then(value=>setAuthenticated(value.authenticated)).catch(error=>setError(error.message)).finally(()=>setReady(true));
    const expired=()=>{clearSessionKeys();setAuthenticated(false);setError('Your session expired. Sign in again.');};
    window.addEventListener('h3x-auth-required',expired);return()=>window.removeEventListener('h3x-auth-required',expired);
  },[]);
  async function login(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{await requestJson('/api/login',{key});setKey('');setAuthenticated(true);await log('Signed in')}catch(error){setError((error as Error).message)}finally{setBusy(false)}}
  async function logout(){setBusy(true);try{await requestJson('/api/logout',{});clearSessionKeys();setAuthenticated(false);setError('')}catch(error){setError((error as Error).message)}finally{setBusy(false)}}
  if(authenticated)return <><App/><button className="web-signout" onClick={logout} disabled={busy} title="Sign out and clear session keys"><LogOut size={14}/><span>Sign out</span></button></>;
  return <main className="web-login"><section className="web-login-card"><div className="web-login-brand">H<span>3</span>X <small>V2 / WEB</small></div><div className="eyebrow"><Cloud size={14}/>CLOUDFLARE WORKSPACE</div><h1>Your investigation<br/>workspace, online.</h1><p>The H3X tools and interface, available in your browser.</p><form onSubmit={login}><label htmlFor="access-key">Workspace access key</label><div className="web-key-input"><LockKeyhole size={17}/><input id="access-key" type="password" autoComplete="current-password" value={key} onChange={event=>setKey(event.target.value)} placeholder="Enter your access key" required disabled={!ready||busy}/></div><button className="primary" disabled={!ready||busy||!key}>{!ready?'Connecting…':busy?'Signing in…':'Open workspace'}<ArrowRight size={17}/></button>{error&&<p className="web-login-error" role="alert">{error}</p>}</form><div className="web-login-foot">Workspace data stays in this browser.<br/>Searches are handled by your Cloudflare Worker.</div></section><span className="web-login-version">H3X SEARCHER / 0.2.9</span></main>;
}
