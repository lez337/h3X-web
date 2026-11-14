import {useEffect,useState} from 'react';
import {requestJson} from './bridge';

export default function AccountApiKey(){
  const [enabled,setEnabled]=useState(false),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  useEffect(()=>{let active=true;requestJson('/api/account/api-key').then(value=>{if(active)setEnabled(value.enabled)}).catch(error=>{if(active)setError(error.message)});return()=>{active=false}},[]);
  async function change(action:'create'|'revoke'){
    setBusy(true);setError('');setCopied(false);
    try{const value=await requestJson('/api/account/api-key',{action});setEnabled(value.enabled);setKey(value.key||'')}catch(error){setError((error as Error).message)}finally{setBusy(false)}
  }
  return <section className="web-account-code"><h3>Equicord / account API</h3><p>No H3X call quota. Hosting and provider limits still apply. This private key allows Discord searches only.</p><p>Status: {enabled?'Active':'No active key'}</p>
    {key&&<><label htmlFor="account-api-key">Copy now — this key is shown once</label><textarea id="account-api-key" readOnly value={key} rows={4} style={{width:'100%',overflowWrap:'anywhere'}} onFocus={event=>event.currentTarget.select()}/><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(key);setCopied(true)}catch{setError('Select the key and copy it manually.')}}}>{copied?'Copied':'Copy API key'}</button></>}
    <div className="web-account-actions"><button type="button" disabled={busy} onClick={()=>change('create')}>{enabled?'Replace API key':'Generate API key'}</button>{enabled&&<button type="button" disabled={busy} onClick={()=>change('revoke')}>Revoke API key</button>}</div>
    <p>Replacing or revoking immediately disables the old key. In H3XSearch plugin settings, use this site URL: <code>{location.origin}</code></p>
    {error&&<p className="web-login-error" role="alert">{error}</p>}
  </section>;
}
