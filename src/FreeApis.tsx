import {useEffect,useState} from 'react';
import {ExternalLink} from 'lucide-react';
import catalog from '../electron/free-provider-catalog.json';
import './free-apis.css';

export {catalog as freeApiCatalog};
export const legacyProviders=[['oathnet','OathNet'],['brixhub','BrixHub'],['whatsmyname','Username search'],['github','GitHub'],['rdap','RDAP']];
export const allProviderChoices=[...legacyProviders,...catalog.map(p=>[p.id,p.label])];
const groups=[...new Set(catalog.map(p=>p.group))];
const message=(error:unknown)=>error instanceof Error?error.message:String(error);

export function ProviderPicker({selected,onChange,disabled=false}:{selected:string[];onChange:(value:string[])=>void;disabled?:boolean}){
 const toggle=(id:string,checked:boolean)=>onChange(checked?[...new Set([...selected,id])]:selected.filter(value=>value!==id));
 return <fieldset className="provider-options" disabled={disabled}><legend>Providers</legend>{legacyProviders.map(([id,label])=><label className="check" key={id}><input type="checkbox" checked={selected.includes(id)} onChange={e=>toggle(id,e.target.checked)}/>{label}</label>)}</fieldset>;
}

function CredentialEditor({id,label,saved,onSaved,onError}:{id:string;label:string;saved:boolean;onSaved:(saved:boolean)=>void;onError:(value:string)=>void}){
 const [key,setKey]=useState(''),[busy,setBusy]=useState(false);
 async function update(value:string){setBusy(true);try{await window.h3x.setCredential(id,value);onSaved(!!value);setKey('');onError(value?label+' key saved.':label+' key removed.')}catch(error){onError(message(error))}finally{setBusy(false)}}
 return <div className="api-credential"><label>API key <small>{saved?'Available for this session':'No session key'}</small><input type="password" aria-label={label+' API key'} autoComplete="off" value={key} maxLength={1024} placeholder={saved?'Replace session key':'Paste your free-account key'} onChange={e=>setKey(e.target.value)}/></label><div className="button-row"><button disabled={busy||!key.trim()} onClick={()=>update(key.trim())}>Save session key</button><button disabled={busy||!saved} onClick={()=>update('')}>Remove key</button></div></div>;
}

export function FreeApiSettings({settings,setting,onError,selected,onChange,disabled=false}:{settings:Record<string,any>;setting:(key:string,value:any)=>void;onError:(value:string)=>void;selected:string[];onChange:(value:string[])=>void;disabled?:boolean}){
 const [status,setStatus]=useState<Record<string,boolean>>({}),[filter,setFilter]=useState('');
 useEffect(()=>{let stale=false;window.h3x.credentials().then(value=>{if(!stale)setStatus(value)}).catch(error=>{if(!stale)onError(message(error))});return()=>{stale=true}},[]);
 const visible=catalog.filter(p=>[p.label,p.description,...p.inputs].join(' ').toLowerCase().includes(filter.toLowerCase()));
 const toggle=(id:string,checked:boolean)=>onChange(checked?[...new Set([...selected,id])]:selected.filter(value=>value!==id));
 const selectedCount=catalog.filter(p=>selected.includes(p.id)).length;
 return <><section className="panel free-settings-intro"><h2>Free APIs</h2><div className="button-row"><button disabled={disabled} onClick={()=>onChange([...new Set([...selected,...catalog.filter(p=>p.credential!=='required').map(p=>p.id)])])}>Enable keyless APIs</button><button disabled={disabled||!selectedCount} onClick={()=>onChange(selected.filter(id=>!catalog.some(p=>p.id===id)))}>Disable all free APIs</button><span className="muted">{selectedCount} enabled in Search</span></div><div className="provider-field-grid"><label>Maximum cards per provider<select value={settings.freeApiLimit||10} onChange={e=>setting('freeApiLimit',Number(e.target.value))}>{[5,10,20,50].map(n=><option key={n}>{n}</option>)}</select></label><label>Find a provider<input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Name, category or input type"/></label></div></section>
  {groups.map(group=>visible.some(p=>p.group===group)&&<section className="panel free-settings-group" key={group}><h2>{group}</h2>{visible.filter(p=>p.group===group).map(p=><details className="api-setting" key={p.id}><summary><span>{p.label}<small>{p.inputs.join(' · ')}</small></span><span className="api-key-status">{selected.includes(p.id)?'Enabled · ':''}{p.credential==='required'?(status[p.id]?'Key saved':'Key required'):p.credential==='optional'?(status[p.id]?'Key saved':'Optional key'):'No key'}</span></summary><div className="api-setting-body"><label className="check api-enable"><input type="checkbox" disabled={disabled} checked={selected.includes(p.id)} onChange={e=>toggle(p.id,e.target.checked)}/>Enable {p.label} in Search</label><p className="muted">{p.description}</p><div className="api-free-plan">{p.free}</div><button className="api-docs" onClick={()=>window.h3x.openExternal(p.docs).catch(error=>onError(message(error)))}><ExternalLink size={13}/> Documentation & limits</button>{p.credential&&<CredentialEditor id={p.id} label={p.label} saved={!!status[p.id]} onSaved={saved=>setStatus(previous=>({...previous,[p.id]:saved}))} onError={onError}/>}</div></details>)}</section>)}
  {!visible.length&&<p className="muted">No providers match this filter.</p>}
 </>;
}

export function ProviderStatus({statuses,notice}:{statuses:any[];notice?:string}){
 if(!statuses?.length)return null;
 const completed=statuses.filter(s=>s.status==='complete').length,failed=statuses.filter(s=>s.status==='error').length,skipped=statuses.filter(s=>s.status==='skipped').length;
 return <details className="provider-run-status"><summary>{completed} providers completed{skipped?` · ${skipped} skipped`:''}{failed?` · ${failed} need attention`:''}<small>Details</small></summary><div>{statuses.map(s=><div key={s.id} className={'provider-status-row '+s.status}><b>{s.label}</b><span>{s.status==='complete'?`${s.count} results${s.cached?' · cached':''}${s.limited?' · limit reached':''}`:s.status==='skipped'?'Skipped':'Unavailable'}</span>{s.message&&<small>{s.message}</small>}</div>)}{notice&&<p className="muted">{notice}</p>}</div></details>;
}
