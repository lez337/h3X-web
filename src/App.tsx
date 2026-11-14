import {visibleFields} from './fieldVisibility';
import SearchQueryControls,{SearchTypeSelector,SearchCommandHelp} from './SearchQueryControls';
import {parseSearchCommands} from './searchCommands';
import {cardOrder} from './resultCardOrder';
import CountryBadge from './CountryBadge';
import {useEffect,useMemo,useRef,useState} from 'react';
import {LayoutDashboard,Search,FolderOpen,Network,MapPinned,FileSearch,Settings,ExternalLink,Plus,Trash2,Download,ShieldCheck,Bot,Globe,ArrowRight,Activity,Square} from 'lucide-react';
import MapPanel from './MapPanel';
import InvestigationMap from './InvestigationMap';
import {resultLocations} from './mapLocations';
import ProfileCards from './ProfileCards';
import PeopleCards from './PeopleCards';
import PeopleDeepSearch from './PeopleDeepSearch';
import PeopleSaveDialog,{type PeopleSaveTarget} from './PeopleSaveDialog';
import {exportSearchPerson,matchingSavedPerson,mergeSavedPeople} from './peopleExport';
import {mergeSearchPeople} from './peopleMerge';
import {groupPeople,type SearchPerson} from './peopleModel';
import TelegramResult from './TelegramResult';
import SettingsPage from './SettingsPage';
import SearchSettingsDialog from './SearchSettingsDialog';
import {ProviderPicker,ProviderStatus,allProviderChoices} from './FreeApis';
import StealerTree from './StealerTree';
import Updates from './Updates';
import Dashboard from './Dashboard';
import Logs from './Logs';
import FileSearcher from './FileSearcher';
import UsernameSearch,{type UsernameProgress} from './UsernameSearch';
import LinkGraph from './LinkGraph';
import type {GraphLink} from './graphModel';
import Investigations,{makePerson,type Case,type Person} from './Investigations';
type Pin={id:string;name:string;lat:number;lng:number;note:string;caseId?:string};
const noSavedPins:Pin[]=[];
type Link=GraphLink;
type Shortcut={id:string;title:string;url:string};
type BotEntry={id:string;name:string;username:string;category:string;template:string;searchEnabled?:boolean};
type SearchEntry={id:string;query:string;providers:string[];searchedAt:string;count:number;response?:any;usernameProgress?:UsernameProgress|null};
const providerChoices=allProviderChoices;
const validProviders=(value:unknown):string[]=>Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'&&providerChoices.some(([key])=>key===id)):[];
type State={version:number;cases:Case[];pins:Pin[];links:Link[];shortcuts:Shortcut[];bots:BotEntry[];settings:Record<string,any>};
const defaultExcluded: string[] = ['id','*_id','es_ids','timestamp','timestamps','created_at','updated_at','indexed_at','saved_at','password','token','cookie','session'];
const initial:State={version:1,cases:[],pins:[],links:[],shortcuts:[],bots:[],settings:{rememberProviders:true,oathFamily:'both',pageSize:20,brixField:'auto',flexible:false,ghuntPath:'',spiderfootUrl:'http://127.0.0.1:5001'}};
const nav=[['dashboard','Dashboard',LayoutDashboard],['search','Search',Search],['logs','Logs',Activity],['cases','Investigations',FolderOpen],['graph','Link graph',Network],['map','Map',MapPinned],['files','File search',FileSearch],['tools','Integrations',Bot],['shortcuts','Shortcuts',Globe],['settings','Settings',Settings]] as const;
function flatten(x:any):string{return typeof x==='object'?JSON.stringify(x):String(x??'')}
function err(e:any){return e instanceof Error?e.message:String(e)}
function orderedFields(fields:Record<string,unknown>){
 const rank=(key:string)=>{const k=key.replace(/[_\s.-]/g,'').toLowerCase();
  if(/^(name|fullname|firstname|lastname|surname|givenname|nom|prenom|nomfamille|nomaffichage|nomdefamille)$/.test(k))return 0;
  if(/^(age|edad|eta|âge)$/.test(k))return 1;
  if(/^(address|addressstreet|homeaddress|streetaddress|residentialaddress|adresse|adressedomicile|indirizzo|street)$/.test(k))return 2;
  if(/phone|telephone|mobile|cellulare|telefono/.test(k))return 3;
  return 4;
 };
 return Object.entries(fields||{}).sort(([a],[b])=>rank(a)-rank(b));
}

function ResultFields({fields,onLocate,onOpen}:{fields:Record<string,unknown>;onLocate:(value:string)=>void;onOpen:(value:string)=>void}){
 const entries=orderedFields(fields);
 const render=([key,value]:[string,unknown])=><div className="result-field" key={key}><small>{key.replace(/_/g,' ')}</small><span>{/^(output|response)$/.test(key)?<pre className="provider-output">{flatten(value)}</pre>:typeof value==='string'&&/^https?:\/\/[^\s]+$/i.test(value)?<button type="button" className="result-source-link" title="Open source" onClick={()=>onOpen(value)}>{value}<ExternalLink size={11}/></button>:flatten(value)}{/address|adresse/i.test(key)&&!/ip|email/i.test(key)&&typeof value==='string'&&<button className="locate-address" type="button" aria-label="Show address on map" title="Show on map" onClick={()=>onLocate(value)}><MapPinned size={13} strokeWidth={1.7}/></button>}</span></div>;
 return <div className="result-fields">{entries.slice(0,6).map(render)}{entries.length>6&&<details className="more-fields"><summary>More details ({entries.length-6})</summary>{entries.slice(6).map(render)}</details>}</div>;
}
export default function App(){
 const [usernameProgress,setUsernameProgress]=useState<UsernameProgress|null>(null),[usernameBusy,setUsernameBusy]=useState(false);
 const usernameRunId=useRef('');
 const normalLocked=useRef(false),normalStopped=useRef(false);
 const [stoppingSearch,setStoppingSearch]=useState(false);
 const [peopleSaveQuery,setPeopleSaveQuery]=useState<string|null>(null);
 const usernameSnapshot=useRef<UsernameProgress|null>(null);
 useEffect(()=>window.h3x.onUsernameProgress?.(update=>{if(update.runId!==usernameRunId.current)return;setUsernameProgress(previous=>({...update,results:[...(previous?.runId===update.runId?previous.results:[]),...update.results]}));if(update.finished)setUsernameBusy(false)}),[]);
 useEffect(()=>{usernameSnapshot.current=usernameProgress},[usernameProgress]);
 const [searchSettingsOpen,setSearchSettingsOpen]=useState(false);
 const [page,setPage]=useState('dashboard'),[state,setState]=useState<State>(initial),[ready,setReady]=useState(false),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[credential,setCredential]=useState(false);
 const [searchQueryType,setSearchQueryType]=useState('auto');
 const [query,setQuery]=useState(''),[providers,setProviders]=useState(['github','rdap']),[result,setResult]=useState<any>(null),[resultFilter,setResultFilter]=useState('');
 const [sourceFilter,setSourceFilter]=useState('all'),[focusPin,setFocusPin]=useState<string>(),[mapQuery,setMapQuery]=useState('');
 const [selectedCase,setSelectedCase]=useState<string|null>(null);
 const [peopleToSave,setPeopleToSave]=useState<SearchPerson[]|null>(null);
 const [deepPerson,setDeepPerson]=useState<SearchPerson|null>(null),[deepOpen,setDeepOpen]=useState(false);
 const [personId,setPersonId]=useState<string|null>(null),[saveItem,setSaveItem]=useState<any>(null),[targetCase,setTargetCase]=useState(''),[targetPerson,setTargetPerson]=useState('');
 const [logs,setLogs]=useState<any[]>([]);
 const [focusedResult,setFocusedResult]=useState<string|null>(null);
 useEffect(()=>{if(!focusedResult)return;const timer=setTimeout(()=>setFocusedResult(null),4000);return()=>clearTimeout(timer)},[focusedResult]);
 const excludedFields:string[]=[...(state.settings.excludedFields??defaultExcluded),...(state.settings.hiddenFields||[])];
 useEffect(()=>{const refresh=()=>window.h3x.logs().then(setLogs).catch(e=>setNotice('Could not load logs: '+err(e)));refresh();const timer=setInterval(refresh,2000);return()=>clearInterval(timer)},[]);

 const [shortcutTitle,setShortcutTitle]=useState(''),[shortcutUrl,setShortcutUrl]=useState('');
 useEffect(()=>{window.h3x.load().then(s=>{const settings={...initial.settings,...s.settings,brixField:"auto"};if(!settings.esIdsExclusionAdded){settings.hiddenFields=[...new Set([...(settings.hiddenFields||[]),'es_ids'])];settings.esIdsExclusionAdded=true}setState({...s,settings});if(s.settings?.rememberProviders!==false&&Array.isArray(s.settings?.selectedProviders))setProviders(validProviders(s.settings.selectedProviders));setReady(true)}).catch(e=>setNotice(err(e)));window.h3x.credentials().then(s=>setCredential(s.oathnet)).catch(e=>setNotice(err(e)))},[]);
 useEffect(()=>{if(!ready)return;const save=()=>window.h3x.save(state);const timer=setTimeout(()=>save().catch(e=>setNotice('Save failed: '+err(e))),350);const flush=(event:Event)=>{clearTimeout(timer);(event as CustomEvent<Promise<unknown>[]>).detail.push(save())};window.addEventListener('h3x-save-now',flush);return()=>{clearTimeout(timer);window.removeEventListener('h3x-save-now',flush)}},[state,ready]);
 const update=(patch:Partial<State>)=>setState(s=>({...s,...patch}));const setting=(key:string,value:any)=>setState(s=>({...s,settings:{...s.settings,[key]:value}}));
 const commandSearch=useMemo(()=>parseSearchCommands(query,state.settings,searchQueryType),[query,state.settings,searchQueryType]);
 const hasFilterQuery=providers.some(p=>['oathnet','brixhub'].includes(p)&&Object.values(commandSearch.settings[p==='oathnet'?'oathFilters':'brixFilters']||{}).some(v=>Array.isArray(v)?v.length:typeof v==='object'&&v?Object.keys(v).length:!!String(v||'').trim()));
 const history:SearchEntry[]=Array.isArray(state.settings.searchHistory)?state.settings.searchHistory:[];
 function selectProviders(value:string[]){setProviders(value);if(state.settings.rememberProviders!==false)setting('selectedProviders',value)}
 function rememberProviders(enabled:boolean){setState(s=>({...s,settings:{...s.settings,rememberProviders:enabled,selectedProviders:enabled?providers:undefined}}))}
 function clearSearchFilters(){setQuery(commandSearch.query);setState(s=>({...s,settings:{...s.settings,brixFilters:{},oathFilters:{},oathOptions:{},page:1,cursor:undefined}}))}
 async function runSearch(){
  if(commandSearch.error){setNotice(commandSearch.error);return;}
  if(normalLocked.current||!commandSearch.query&&!hasFilterQuery||!providers.length)return;
  normalLocked.current=true;normalStopped.current=false;setStoppingSearch(false);
  const runId=crypto.randomUUID();usernameRunId.current=runId;setUsernameProgress(null);setUsernameBusy(providers.includes('whatsmyname'));
  setBusy(true);setNotice('');setResult(null);setMapQuery('');setFocusedResult(null);setSourceFilter('all');setResultFilter('');
  try{await window.h3x.save(state);if(normalStopped.current)return;const response=await window.h3x.searchBatch({providers,query:commandSearch.query,settings:commandSearch.settings,runId,usernameRunId:runId});setResult(response);if(response.meta?.canceled)setNotice('Search stopped; completed results retained.');if(response.meta?.usernameRun)setUsernameProgress({...response.meta.usernameRun,finished:true});const entry:SearchEntry={id:crypto.randomUUID(),query:query.trim(),providers:[...providers],searchedAt:new Date().toISOString(),count:response.items?.length||0,response:structuredClone(response),usernameProgress:response.meta?.usernameRun?{...response.meta.usernameRun,finished:true}:usernameSnapshot.current};setState(s=>({...s,settings:{...s.settings,searchHistory:[entry,...(s.settings.searchHistory||[])].slice(0,100).map((entry:SearchEntry,index:number)=>index<5?entry:{...entry,response:undefined,usernameProgress:undefined})}}));}
  catch(e){setNotice(normalStopped.current?'Search stopped.':err(e))}finally{usernameRunId.current='';normalLocked.current=false;setUsernameBusy(false);setBusy(false);setStoppingSearch(false)}
 }
 async function stopSearch(){if(!usernameRunId.current||normalStopped.current)return;normalStopped.current=true;setStoppingSearch(true);try{await window.h3x.cancelSearch(usernameRunId.current)}catch(e){setNotice(err(e));normalStopped.current=false;setStoppingSearch(false)}}
 function restoreSearch(entry:SearchEntry){
  if(busy)return;
  // History restores a snapshot; the provider picker controls the next live search.
  const addedProviders=providers.some(provider=>!entry.providers.includes(provider));
  setSearchQueryType('auto');setQuery(entry.query);setSourceFilter('all');setResultFilter('');setMapQuery('');setFocusedResult(null);setNotice(entry.response?(addedProviders?'Showing saved cards. Press Search to include your newly selected providers.':''):'No saved cards for this older search. Press Search to run it again.');
  setResult(entry.response?structuredClone(entry.response):null);usernameRunId.current='';setUsernameBusy(false);setUsernameProgress(entry.usernameProgress||null);
  document.querySelector('.search-hero')?.scrollIntoView({behavior:'smooth'});
 }
 const filtered=useMemo(()=>result?.items?.filter((x:any)=>(sourceFilter==='all'||x.source===sourceFilter)&&flatten(x.fields).toLowerCase().includes(resultFilter.toLowerCase())).map((item:any)=>({...item,fields:visibleFields(item.fields,state.settings.hiddenFields||[])}))||[],[result,resultFilter,sourceFilter,state.settings.hiddenFields]);
 const [mapPerson,setMapPerson]=useState<{id:string}|null>(null);
 const mapPeople=useMemo(()=>groupPeople(filtered),[filtered]);
 const mapLocations=useMemo(()=>resultLocations(filtered),[filtered]);
 function openResult(id:string){
  setFocusedResult(id);
  requestAnimationFrame(()=>{const card=document.getElementById('result-'+encodeURIComponent(id));if(!card)return;for(let parent=card.parentElement;parent;parent=parent.parentElement){if(parent instanceof HTMLDetailsElement)parent.open=true}card.querySelectorAll('details.more-fields').forEach(details=>details.setAttribute('open',''));card.scrollIntoView({behavior:'smooth',block:'center'});card.focus({preventScroll:true})});
 }
 function newCase(){setPersonId(null);const now=new Date().toISOString(),id=crypto.randomUUID();update({cases:[{id,title:'New investigation',type:'Person',summary:'',notes:'',createdAt:now,updatedAt:now},...state.cases]});setSelectedCase(id)}
 async function savePeople(target:PeopleSaveTarget){
  if(!peopleToSave?.length)return;
  const now=new Date().toISOString();
  const existing=state.cases.find(c=>c.id===target.caseId);
  if(target.caseId&&!existing)throw Error('This investigation no longer exists. Choose another destination.');
  const investigation:Case=existing||{id:crypto.randomUUID(),title:target.title,type:'Person',summary:'',notes:'',createdAt:now,updatedAt:now,people:[]};
  const people=await mergeSavedPeople(investigation.people||[],window.h3x.prepareEvidence,excludedFields);let firstId='';
  const savedIds=new Set<string>();
  const consolidated=mergeSearchPeople(peopleToSave).sort((a,b)=>Number(b.details.some(d=>['name','first_name','last_name'].includes(d.key)))-Number(a.details.some(d=>['name','first_name','last_name'].includes(d.key))));
  for(const searchPerson of consolidated){
   const current=peopleToSave.length===1&&target.personId?people.find(p=>p.id===target.personId):matchingSavedPerson(searchPerson,people);
   if(target.personId&&peopleToSave.length===1&&!current)throw Error('This person folder no longer exists. Choose another folder.');
   const saved=await exportSearchPerson(searchPerson,current||makePerson(people.length+1),window.h3x.prepareEvidence,excludedFields,peopleSaveQuery??result?.query??query);
   if(current)people[people.findIndex(p=>p.id===current.id)]=saved;else people.push(saved);
   savedIds.add(saved.id);firstId||=saved.id;
  }
  const updated={...investigation,updatedAt:now,people};
  const next={...state,cases:existing?state.cases.map(c=>c.id===updated.id?updated:c):[updated,...state.cases]};
  const stored=await window.h3x.save(next);if(stored===false)throw Error('The workspace could not be saved. Try again.');
  setState(next);setSelectedCase(updated.id);setPersonId(firstId);setPeopleToSave(null);setPeopleSaveQuery(null);
  setNotice(`${savedIds.size===1?'Person':savedIds.size+' people'} saved to ${updated.title}.`);
  if(target.openAfter)setPage('cases');
 }
 async function saveEvidence(){
  try{
  const now=new Date().toISOString();let c=state.cases.find(c=>c.id===targetCase);
  if(!c)c={id:crypto.randomUUID(),title:(saveItem.query||result?.query||query).trim()||'New investigation',type:'Person',summary:'',notes:'',createdAt:now,updatedAt:now,people:[]};
  const people=c.people||[];let person=people.find(p=>p.id===targetPerson);const isNew=!person;
  if(!person)person=makePerson(people.length+1);
  const prepared=await window.h3x.prepareEvidence({fields:saveItem.fields||{},excluded:excludedFields,current:person});
  const patch:Partial<Person>={};Object.entries(prepared.patch).forEach(([key,value])=>{if(['phone','email','username','altPhone'].includes(key)||isNew||!(person as any)[key]||(key==='name'&&/^Person \d+$/.test(person!.name)))(patch as any)[key]=value});
  person={...person,...patch,evidence:[...(person.evidence||[]),{id:crypto.randomUUID(),source:sourceLabel(saveItem.source),query:saveItem.query||result?.query||query,savedAt:now,fields:prepared.fields}]};
  const updated={...c,updatedAt:now,people:isNew?[...people,person]:people.map(p=>p.id===person!.id?person!:p)};
  update({cases:state.cases.some(x=>x.id===c!.id)?state.cases.map(x=>x.id===c!.id?updated:x):[updated,...state.cases]});setSelectedCase(c.id);setPersonId(person.id);setSaveItem(null);setNotice('Evidence saved to '+person.name+' in '+c.title+'.');
  }catch(e){setNotice('Save failed: '+err(e))}
 }
 function addShortcut(){try{const url=new URL(shortcutUrl);if(!['https:','http:'].includes(url.protocol))throw Error('Only web links are allowed.');update({shortcuts:[...state.shortcuts,{id:crypto.randomUUID(),title:shortcutTitle.trim()||url.hostname,url:url.href}]});setShortcutTitle('');setShortcutUrl('')}catch(e){setNotice(err(e))}}
 async function open(url:string){try{await window.h3x.openExternal(url)}catch(e){setNotice(err(e))}}
 const sourceLabel=(source:string)=>source.replace(/\ufffd|\s[?]\s/g,' · ').replace(/oathnet/gi,'OathNet').replace(/brixhub/gi,'BrixHub').replace(/breach/gi,'Breach').replace(/stealer/gi,'Stealer');
 // Keep Oath cards above potentially long archive and public-provider sections,
 // including when reopening a saved search with a different provider order.
 const sourceRank=(source:string)=>/^OathNet\b/i.test(source)?(/breach/i.test(source)?0:/stealer/i.test(source)?1:2):/H3X Username/i.test(source)?4:3;
 const groups=Array.from(new Set<string>((result?.items||[]).map((x:any)=>x.source))).sort((a,b)=>sourceRank(a)-sourceRank(b));
 // Username scans keep their own status filters and pagination in the main results column.
 const usernameCards=usernameProgress&&(sourceFilter==='all'||sourceFilter==='H3X Username')?<UsernameSearch progress={usernameProgress} busy={usernameBusy} onError={setNotice} onSave={item=>{setSaveItem(item);setTargetCase(selectedCase||'');setTargetPerson(personId||'')}}/>:null;
 const datasetItems=filtered.filter((item:any)=>!item.profileType||item.profileType==='telegram'||item.profileType==='username'&&!usernameProgress);
 const searchSettings=<ProviderPicker selected={providers} onChange={selectProviders} disabled={busy}/>;

 async function importSaved(){try{const data=await window.h3x.importCase({excluded:excludedFields});if(!data)return;const now=new Date().toISOString();let record:Case;if(data.record){const c=data.record;record={id:crypto.randomUUID(),title:String(c.title||'Imported investigation'),type:'Person',summary:String(c.summary||''),notes:String(c.notes||''),createdAt:now,updatedAt:now,people:await Promise.all((c.people||[]).map(async(p:any,i:number)=>{const details=await window.h3x.prepareEvidence({fields:Object.fromEntries(Object.entries(p).filter(([key])=>key!=='evidence'&&key!=='notes'&&key!=='customCategories')),excluded:excludedFields});return {...makePerson(i+1),...details.patch,customCategories:(p.customCategories||[]).map((category:any)=>({id:crypto.randomUUID(),label:String(category.label||''),value:String(category.value??'')})),notes:String(p.notes||''),evidence:await Promise.all((p.evidence||[]).map(async(e:any)=>({id:crypto.randomUUID(),source:String(e.source||'Import'),query:String(e.query||''),savedAt:now,fields:(await window.h3x.prepareEvidence({fields:e.fields,excluded:excludedFields})).fields})))}}))}}else{const details=await window.h3x.prepareEvidence({fields:data.fields,excluded:excludedFields});if(!Object.keys(details.fields).length)throw Error('No usable fields found. Use label: value lines.');const p={...makePerson(1),...details.patch,evidence:[{id:crypto.randomUUID(),source:'File import',query:'',savedAt:now,fields:details.fields}]};record={id:crypto.randomUUID(),title:p.name,type:'Person',summary:'',notes:'',createdAt:now,updatedAt:now,people:[p]}}update({cases:[record,...state.cases]});setSelectedCase(record.id);setPersonId(record.people?.[0]?.id||null);setPage('cases');setNotice('Imported investigation and mapped person details.')}catch(e){setNotice('Import failed: '+err(e))}}


 return <div className="shell"><aside className="sidebar"><div className="brand"><span className="brand-icon">H<span>3</span>X</span><div><b>SEARCHER</b><small>INTELLIGENCE WORKSPACE</small></div></div><div className="sidebar-section">WORKSPACE</div><nav>{nav.slice(0,7).map(([id,label,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}><Icon size={16}/>{label}</button>)}</nav><div className="sidebar-section">RESOURCES</div><nav>{nav.slice(7).map(([id,label,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}><Icon size={16}/>{label}</button>)}</nav></aside>
 <main className="main"><header className="topbar"><div className="breadcrumb">H3X <span>/</span> {nav.find(x=>x[0]===page)?.[1]}</div></header>{notice&&<div className="notice" role="alert">{notice}<button onClick={()=>setNotice('')}>×</button></div>}
 <div className="web-platform-note">H3X v2 Web · Saved in this browser · Back up your workspace in Settings → Search.</div>
 {page==='dashboard'&&<Dashboard cases={state.cases} pins={state.pins} linkCount={state.links.length} botCount={state.bots.length} ready={ready} onNavigate={setPage} onNewCase={()=>{newCase();setPage('cases')}} onOpenCase={id=>{setSelectedCase(id);setPersonId(null);setPage('cases')}} onOpenPin={id=>{setFocusPin(id);setPage('map')}} onSearch={value=>{setQuery(value);setResult(null);setMapQuery('');setFocusedResult(null);setPage('search')}}/>}
 {page==='logs'&&<div className="content logs-page"><div className="eyebrow">WORKSPACE ACTIVITY</div><h1>Logs</h1><Logs entries={logs} onError={setNotice}/></div>}
 {page==='search'&&<div className={'content search-page '+(!result?.items?.length?'search-empty':'')}><div className="search-hero"><div className="eyebrow">PROVIDER SEARCH</div><h1>What would you like to search?</h1><div className="search-box" onPointerMove={event=>{if(event.pointerType!=='mouse'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;const surface=event.currentTarget;const rect=surface.getBoundingClientRect();surface.style.setProperty('--search-light-x',`${event.clientX-rect.left}px`);surface.style.setProperty('--search-light-y',`${event.clientY-rect.top}px`)}} onPointerLeave={event=>{event.currentTarget.style.removeProperty('--search-light-x');event.currentTarget.style.removeProperty('--search-light-y')}}><input autoFocus disabled={busy} aria-label="Search query" aria-describedby="search-command-status" placeholder="Search or use / command" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&runSearch()}/><div className="search-box-bottom"><SearchTypeSelector query={commandSearch.query} type={commandSearch.settings.searchQueryType} onType={setSearchQueryType} disabled={busy}/><button className="provider-settings-trigger" aria-label="Search settings" title="Search settings" aria-haspopup="dialog" onClick={()=>setSearchSettingsOpen(true)}><Settings size={18}/></button><button className="primary" disabled={busy||!commandSearch.query&&!hasFilterQuery&&!commandSearch.error||!providers.length} onClick={runSearch}>{busy?'Searching…':<><Search size={16}/> Search</>}</button>{busy&&<button className="danger" disabled={stoppingSearch} onClick={stopSearch}><Square size={14}/>{stoppingSearch?'Stopping…':'Stop'}</button>}</div></div><SearchCommandHelp providers={providers} query={query} onQuery={setQuery} disabled={busy} error={commandSearch.error} used={commandSearch.used}/><SearchQueryControls providers={providers} settings={commandSearch.settings}/><div className="search-controls">{searchSettings}</div></div>{busy&&<div className="search-loading" role="status"><span className="search-spinner" aria-hidden="true"/><div><b>Searching selected providers</b></div><span className="search-loading-track" aria-hidden="true"/></div>}{!result&&usernameCards}{result&&<div className="results"><div id="search-locations" className="search-map"><h2>Result addresses</h2><MapPanel compact locations={mapLocations} locationQuery={mapQuery} pins={noSavedPins} people={mapPeople} onOpenPerson={id=>setMapPerson({id})} onAdd={p=>setState(s=>({...s,pins:[...s.pins,p]}))} onRemove={id=>setState(s=>({...s,pins:s.pins.filter(p=>p.id!==id)}))} openExternal={open}/></div><ProviderStatus statuses={result.meta?.providerStatus} notice={result.notice}/><div className="section-head"><div><div className="eyebrow">RESULTS · {result.items.length} SHOWN</div><h2>Search results</h2><button onClick={()=>window.h3x.exportSearch({items:filtered}).catch(e=>setNotice(err(e)))}><Download size={15}/> Export TXT</button></div><div className="source-tabs">{['all',...groups].map(source=><button key={source} className={sourceFilter===source?'selected':''} onClick={()=>setSourceFilter(source)}>{source==='all'?'All results':sourceLabel(source)}</button>)}</div><input className="filter" placeholder="Filter results" value={resultFilter} onChange={e=>setResultFilter(e.target.value)}/></div><div className="results-layout" onPointerMove={event=>{if(event.pointerType==='touch'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;const surface=(event.target as HTMLElement).closest<HTMLElement>('.liquid-glass');if(!surface)return;const rect=surface.getBoundingClientRect();surface.style.setProperty('--reflection-x',`${event.clientX-rect.left}px`);surface.style.setProperty('--reflection-y',`${event.clientY-rect.top}px`)}}><aside className="result-sidebar"><div className="result-card-group" style={{order:cardOrder(state.settings.resultCardOrder).indexOf('people')}}><PeopleCards key={'people:'+result.query} items={filtered} focusPerson={mapPerson} onShowRecord={openResult} onExport={setPeopleToSave} onOpen={open} onDeepSearch={person=>{setDeepPerson(current=>current?.id===person.id?current:person);setDeepOpen(true)}}/></div><div className="result-card-group" style={{order:cardOrder(state.settings.resultCardOrder).indexOf('oath')}}><ProfileCards key={'profiles:'+result.query} items={filtered} showOath={providers.includes('oathnet')&&state.settings.oathProfiles!==false} onOpen={open} onSave={item=>{setSaveItem(item);setTargetCase(selectedCase||'');setTargetPerson(personId||'')}}/></div><div className="result-card-group" style={{order:cardOrder(state.settings.resultCardOrder).indexOf('overview')}}><section className="summary-card liquid-glass"><div className="eyebrow">SEARCH OVERVIEW</div><h3>{query}</h3><div className="exposure-count">{filtered.length}</div><p className="muted">Records on this page</p><div className="exposure-split"><span>Breach<b>{filtered.filter((x:any)=>/breach/i.test(x.source)).length}</b></span><span>Stealer<b>{filtered.filter((x:any)=>/stealer/i.test(x.source)).length}</b></span></div></section></div><div className="result-card-group" style={{order:cardOrder(state.settings.resultCardOrder).indexOf('sources')}}><section className="summary-card liquid-glass"><h3>Sources</h3>{groups.map(source=><button className="source-row" key={source} onClick={()=>setSourceFilter(source)}><span>{sourceLabel(source)}</span><b>{result.items.filter((x:any)=>x.source===source).length}</b></button>)}</section></div></aside><div className="dataset-results">{groups.filter(source=>datasetItems.some((item:any)=>item.source===source)).filter(source=>sourceFilter==='all'||sourceFilter===source).map(source=><section className="dataset-section" key={source}><div className="dataset-heading"><ShieldCheck size={18}/><h3>{sourceLabel(source)}</h3><span className="tag">{datasetItems.filter((x:any)=>x.source===source).length} records</span></div><div className="result-grid">{datasetItems.filter((x:any)=>x.source===source).map((item:any)=><article className={`result-card liquid-glass ${focusedResult===item.id?'map-focused-card':''}`} id={'result-'+encodeURIComponent(item.id)} tabIndex={-1} key={item.id}><div className="result-top"><span className="tag">{sourceLabel(item.source)}</span><CountryBadge fields={item.fields}/></div>{item.profileType==='telegram'||/^Telegram\b/i.test(item.source)?<TelegramResult item={item}/>:<ResultFields fields={item.fields||{}} onOpen={open} onLocate={value=>{setMapQuery(mapLocations.find(p=>p.resultIds.includes(item.id)&&p.address.startsWith(value))?.address||value);document.getElementById('search-locations')?.scrollIntoView({behavior:'smooth'})}}/>}{/stealer/i.test(item.source)&&<StealerTree key={item.logId||item.id} logId={item.logId}/>}<button className="save-investigation" onClick={()=>{setSaveItem(item);setTargetCase(selectedCase||'');setTargetPerson(personId||'')}}><FolderOpen size={15}/> Save to person <Plus size={14}/></button></article>)}</div></section>)}{usernameCards}{!filtered.length&&<div className="empty">No results match this local filter.</div>}</div></div>{result.meta?.total!=null&&<p className="muted">Provider reported {result.meta.total} total records. Displayed page only.</p>}{result.meta?.nextCursor&&<button onClick={()=>{setting('cursor',result.meta.nextCursor);setNotice('Cursor saved. Run the search again to load the next page.')}}>Use next cursor</button>}</div>}<section className="search-history" aria-labelledby="search-history-title"><div className="section-head"><h2 id="search-history-title">Search history</h2><button disabled={!history.length} onClick={()=>setting('searchHistory',[])}><Trash2 size={14}/> Clear history</button></div>{history.length?<div className="search-history-list">{history.map(entry=><div className="search-history-row" key={entry.id}><button className="history-restore" disabled={busy} title={entry.response?'Show saved cards':'Load query and providers'} onClick={()=>restoreSearch(entry)}><b>{entry.query}</b></button><button aria-label={'Remove search '+entry.query} onClick={()=>setting('searchHistory',history.filter(item=>item.id!==entry.id))}><Trash2 size={14}/></button></div>)}</div>:null}</section></div>}
 {page==='search'&&searchSettingsOpen&&<SearchSettingsDialog onClearFilters={clearSearchFilters} searchBusy={busy} settings={state.settings} setting={setting} initialProvider={providers.includes('whatsmyname')&&!providers.includes('oathnet')&&!providers.includes('brixhub')?'whatsmyname':providers.includes('brixhub')&&!providers.includes('oathnet')?'brixhub':'oathnet'} onClose={()=>setSearchSettingsOpen(false)}/>}
 {page==='cases'&&<Investigations hiddenFields={state.settings.hiddenFields||[]} excludedFields={excludedFields} onImport={importSaved} cases={state.cases} selected={selectedCase} setSelected={setSelectedCase} personId={personId} setPersonId={setPersonId} onNew={newCase} onError={setNotice} onChange={c=>update({cases:state.cases.map(x=>x.id===c.id?c:x)})} onDelete={id=>{update({cases:state.cases.filter(c=>c.id!==id),links:state.links.filter(l=>l.from!==id&&l.to!==id),pins:state.pins.map(p=>p.caseId===id?{...p,caseId:undefined}:p)});setSelectedCase(null);setPersonId(null)}}/>}
 {page==='graph'&&<LinkGraph cases={state.cases} pins={state.pins} links={state.links} graph={state.settings.graphWorkspace} onChange={({cases,pins,links,graph})=>setState(s=>({...s,cases,pins,links,settings:{...s.settings,graphWorkspace:graph}}))} onOpen={(source,id,personId)=>{if(source==='case'){setSelectedCase(id);setPersonId(personId||null);setPage('cases')}else{setFocusPin(id);setPage('map')}}}/> }
 {page==='map'&&<div className="content map-page"><div className="eyebrow">GEOSPATIAL NOTES</div><h1>Investigation map</h1><InvestigationMap pins={state.pins} focusPin={focusPin} locationQuery={mapQuery} cases={state.cases} hiddenFields={state.settings.hiddenFields||[]} onOpenCase={(id,person)=>{setSelectedCase(id);setPersonId(person||null);setPage('cases')}} onAdd={p=>update({pins:[...state.pins,p]})} onRemove={id=>update({pins:state.pins.filter(p=>p.id!==id)})} openExternal={open}/></div>}
 <section hidden={page!=='files'}><FileSearcher onError={setNotice} onSave={item=>{setSaveItem(item);setTargetCase(selectedCase||'');setTargetPerson(personId||'')}}/></section>
 {page==='tools'&&<div className="content"><h1>Integrations</h1><div className="panel"><div className="button-row"><button onClick={()=>setPage('settings')}><Settings size={16}/> Provider settings</button><button onClick={()=>setPage('search')}><Search size={16}/> Search</button><button onClick={()=>open(state.settings.spiderfootUrl)}>Open SpiderFoot</button></div></div></div>}
 {page==='shortcuts'&&<div className="content"><div className="eyebrow">QUICK ACCESS</div><h1>Website shortcuts</h1><div className="file-toolbar"><input placeholder="Name" value={shortcutTitle} onChange={e=>setShortcutTitle(e.target.value)}/><input placeholder="https://example.org" value={shortcutUrl} onChange={e=>setShortcutUrl(e.target.value)}/><button className="primary" onClick={addShortcut}><Plus size={16}/> Add</button></div><div className="shortcut-grid">{state.shortcuts.map(s=><div className="shortcut" key={s.id}><button onClick={()=>open(s.url)}><Globe size={19}/><b>{s.title}</b><small>{s.url}</small></button><button className="danger" onClick={()=>update({shortcuts:state.shortcuts.filter(x=>x.id!==s.id)})}><Trash2 size={15}/></button></div>)}</div></div>}
 {page==='settings'&&<SettingsPage onClearFilters={clearSearchFilters} providers={providers} onProviders={selectProviders} searchBusy={busy} settings={state.settings} setting={(key,value)=>key==='rememberProviders'?rememberProviders(value):setting(key,value)} bots={state.bots} onBots={bots=>update({bots})} excluded={state.settings.excludedFields??defaultExcluded} onError={setNotice} credential={credential} onCredential={setCredential}/>}
 {deepPerson&&!deepOpen&&!peopleToSave&&<button className="deep-resume" onClick={()=>setDeepOpen(true)}><Search size={14}/> Open deep search · {deepPerson.title}</button>}
 {deepPerson&&<PeopleDeepSearch key={deepPerson.id} person={deepPerson} open={deepOpen} credential={credential} settings={state.settings} excluded={excludedFields} onOptionsChange={patch=>setState(s=>({...s,settings:{...s.settings,deepSearchOptions:{...s.settings.deepSearchOptions,...patch}}}))} onClose={()=>setDeepOpen(false)} onDiscard={()=>{setDeepOpen(false);setDeepPerson(null)}} onSave={people=>{setDeepOpen(false);setPeopleToSave(people)}}/>}
 {peopleToSave&&<PeopleSaveDialog people={peopleToSave} cases={state.cases} defaultCase={selectedCase||''} onClose={()=>{setPeopleToSave(null);setPeopleSaveQuery(null)}} onSave={savePeople}/>}
 {saveItem&&<div className="modal-backdrop" onClick={()=>setSaveItem(null)}><section className="save-dialog" role="dialog" aria-modal="true" aria-labelledby="save-title" onClick={e=>e.stopPropagation()}><div className="eyebrow">SAVE EVIDENCE</div><h2 id="save-title">Choose a person folder</h2><label>Investigation<select autoFocus value={targetCase} onChange={e=>{setTargetCase(e.target.value);setTargetPerson('')}}><option value="">Create new investigation</option>{state.cases.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label><label>Person<select value={targetPerson} onChange={e=>setTargetPerson(e.target.value)}><option value="">Create new person folder</option>{(state.cases.find(c=>c.id===targetCase)?.people||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="button-row"><button onClick={()=>setSaveItem(null)}>Cancel</button><button className="primary" onClick={saveEvidence}>Save to folder</button></div></section></div>}
 </main></div>;
}


