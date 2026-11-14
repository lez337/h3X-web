import {useEffect,useRef,useState,type FormEvent} from 'react';
import {UserRound,ChevronUp,X,LogOut,FileCode2,KeyRound,Copy,Check,Cloud} from 'lucide-react';
import {requestJson} from './bridge';
import type {SyncStatus} from './storage';
import AccountApiKey from './AccountApiKey';

export default function AccountMenu({account,sync,busy,onLogout,onReports}:{account:{id:string;name:string};sync:SyncStatus;busy:boolean;onLogout:()=>void;onReports:()=>void}){
  const [open,setOpen]=useState(false),[current,setCurrent]=useState(''),[newKey,setNewKey]=useState(''),[working,setWorking]=useState(false),[saved,setSaved]=useState(false),[copied,setCopied]=useState(false),[error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const close=()=>{if(working||(newKey&&!saved))return;setOpen(false);setCurrent('');setNewKey('');setError('');setSaved(false);setCopied(false);};
  useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
  async function rotate(event:FormEvent){
    event.preventDefault();setWorking(true);setError('');
    try{const value=await requestJson('/api/account/key',{currentKey:current});setNewKey(value.key);setCurrent('');setSaved(false);setCopied(false)}catch(error){setError((error as Error).message)}finally{setWorking(false)}
  }
  async function copy(){try{await navigator.clipboard.writeText(newKey);setCopied(true)}catch{setError('Select the code and copy it manually.')}}
  return <>
    <div className="web-account-dock"><button ref={trigger} className="web-account-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><span className="web-account-avatar"><UserRound size={18}/></span><span className="web-account-label"><strong>{account.name}</strong><small className={'web-sync '+sync.status}>{sync.status==='error'?'Save failed':sync.status==='saving'?'Saving…':'All changes saved'}</small></span><ChevronUp size={15}/></button></div>
    <dialog ref={dialog} className="web-account-dialog" aria-labelledby="account-dialog-title" onCancel={event=>{event.preventDefault();close()}} onClick={event=>{if(event.target===dialog.current)close()}}>
      <div className="web-account-heading"><span className="eyebrow">YOUR WORKSPACE</span><button type="button" aria-label="Close account information" disabled={working||!!newKey&&!saved} onClick={close}><X size={17}/></button></div>
      <h2 id="account-dialog-title">Account information</h2>
      <div className="web-account-identity"><span className="web-account-avatar"><UserRound size={22}/></span><div><small>Account name</small><strong>{account.name}</strong></div></div>
      <p className={'web-account-status web-sync '+sync.status} role="status"><Cloud size={15}/>{sync.status==='error'?sync.message:sync.status==='saving'?'Saving your workspace…':'Your workspace is saved to this account.'}</p>
      {newKey?<section className="web-account-code"><h3>Save your new login code</h3><p>Your old code no longer works. Other sessions have been signed out. This code is shown once.</p><label htmlFor="replacement-login-code">New 8-digit login code</label><div className="report-code-row"><input id="replacement-login-code" readOnly value={newKey} onFocus={event=>event.currentTarget.select()}/><button onClick={copy}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?'Copied':'Copy code'}</button></div><label className="web-account-saved"><input type="checkbox" checked={saved} onChange={event=>setSaved(event.target.checked)}/>I saved my new login code</label><button className="primary" disabled={!saved} onClick={close}>Done<Check size={15}/></button></section>:<>
        <form className="web-account-code" onSubmit={rotate}><h3><KeyRound size={16}/>New login code</h3><p>Generate a new 8-digit code. It replaces your current code and signs out your other sessions. Your investigations stay saved.</p><label htmlFor="current-login-code">Current login code</label><input id="current-login-code" type="password" autoComplete="current-password" inputMode="numeric" pattern="[0-9]{8}" minLength={8} maxLength={8} required value={current} disabled={working} onChange={event=>setCurrent(event.target.value)}/><button type="submit" disabled={working||!/^\d{8}$/.test(current)}><KeyRound size={15}/>{working?'Generating…':'Generate new login code'}</button></form>
        <div className="web-account-actions"><button disabled={working} onClick={()=>{close();onReports()}}><FileCode2 size={16}/>My HTML links</button><button disabled={busy||working} onClick={()=>{close();onLogout()}}><LogOut size={16}/>{busy?'Signing out…':'Sign out'}</button></div>
        {open&&<AccountApiKey key={account.id}/>}
      </>}
      {error&&<p className="web-login-error" role="alert">{error}</p>}
    </dialog>
  </>;
}
