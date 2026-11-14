import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import type {UsernameCatalog,UsernameOptions} from './UsernameSearch';

export const defaultUsernameOptions:UsernameOptions={limit:100,category:'',siteFilter:'',concurrency:10,schemaVersion:2};
export function usernameOptions(settings:Record<string,any>):UsernameOptions{
 return settings.usernameSearchOptions?.schemaVersion===2?{...defaultUsernameOptions,...settings.usernameSearchOptions}:{...defaultUsernameOptions};
}
export default function UsernameSettings({settings,setting}:{settings:Record<string,any>;setting:(key:string,value:any)=>void}){
 const [catalog,setCatalog]=useState<UsernameCatalog|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const options=usernameOptions(settings);
 useEffect(()=>{let stale=false;window.h3x.usernameCatalog().then(value=>{if(!stale)setCatalog(value)}).catch(error=>{if(!stale)setError(String(error.message||error))});return()=>{stale=true}},[]);
 function option<K extends keyof UsernameOptions>(key:K,value:UsernameOptions[K]){setting('usernameSearchOptions',{...options,[key]:value,schemaVersion:2})}
 async function refresh(){setBusy(true);setError('');try{setCatalog(await window.h3x.usernameCatalog(true))}catch(error){setError(error instanceof Error?error.message:String(error))}finally{setBusy(false)}}
 return <section className="panel username-settings"><h2>Username search</h2>
  <label>Sites per search<select aria-label="Username search coverage" value={options.limit} onChange={event=>option('limit',event.target.value==='all'?'all':Number(event.target.value))}><option value="all">All eligible sites</option>{[100,500,2000].map(count=><option value={count} key={count}>{count.toLocaleString()} sites</option>)}</select></label>
  <label>Category<select aria-label="Username search category" value={options.category} onChange={event=>option('category',event.target.value)}><option value="">Every category (default)</option>{catalog?.categories.map(category=><option value={category} key={category}>{category}</option>)}</select></label>
  <label>Site filter<input aria-label="Limit username search to sites" placeholder="All sites; optionally enter a site name or domain" value={options.siteFilter} onChange={event=>option('siteFilter',event.target.value)}/></label>
  <p className="muted">Checks run in batches of five sites, with two checks at a time. The default coverage is 100 sites. Catalog changes arrive with new web deployments.</p>
  
  
  <div className="button-row"><button onClick={()=>setting('usernameSearchOptions',{...defaultUsernameOptions})}>Reset to 100 sites</button></div>
  {catalog&&<small className="muted">{catalog.available.toLocaleString()} usable rules from {catalog.total.toLocaleString()} definitions. Catalog updated {new Date(catalog.snapshot.date).toLocaleDateString()}.</small>}
  {error&&<p className="muted" role="alert">{error}</p>}
  
 </section>;
}
