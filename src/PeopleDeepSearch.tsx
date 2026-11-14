import {useEffect,useMemo,useRef,useState} from 'react';
import {Search,ScanSearch,X,Download,FolderPlus,Trash2,Square,ChevronRight,AlertCircle} from 'lucide-react';
import type {SearchPerson,PeopleItem} from './peopleModel';
import {deepDefaults,deepTerms,makeDeepPlan,pendingDeepPlan,classifyDeepHits,classifyDeepNetwork,nextDeepSearchTerms,deepRecordGroups,reviewedPeople,discoveredContacts,providerFamily,type DeepOptions,type DeepProgress,type DeepMatches,type DeepReviewGroup,type ReviewFact} from './peopleDeepModel';
import {exportSearchPerson,mergeSavedPeople} from './peopleExport';
import {makePerson,type Case} from './Investigations';
import CountryBadge from './CountryBadge';
import './people-deep.css';

type Props={person:SearchPerson;open:boolean;credential:boolean;settings:Record<string,any>;excluded:string[];onOptionsChange:(patch:Partial<DeepOptions>)=>void;onClose:()=>void;onDiscard:()=>void;onSave:(people:SearchPerson[])=>void};
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
export default function PeopleDeepSearch({person,open,credential,settings,excluded,onOptionsChange,onClose,onDiscard,onSave}:Props){
 const terms=useMemo(()=>deepTerms(person),[person]);
 const [options,setOptions]=useState<DeepOptions>(()=>{
  const saved={...deepDefaults,keepSearching:true,...settings.deepSearchProviders,...settings.deepSearchOptions};
  return {...saved,ghunt:false,longSearch:false,oath:credential&&saved.oath,keepSearching:saved.keepSearching};
 }),[chosen,setChosen]=useState(new Set(terms.slice(0,24).map(t=>t.id)));
 const [phase,setPhase]=useState<'confirm'|'running'|'review'>('confirm'),[progress,setProgress]=useState<DeepProgress|null>(null),[groups,setGroups]=useState<DeepReviewGroup[]>([]),[matches,setMatches]=useState<DeepMatches>({same:[],related:[],unmatched:[]}),[warnings,setWarnings]=useState<string[]>([]),[limited,setLimited]=useState(false),[canceled,setCanceled]=useState(false),[followed,setFollowed]=useState(0),[round,setRound]=useState(0);
 const [showRelated,setShowRelated]=useState(true),[showUnmatched,setShowUnmatched]=useState(false),[groupLimit,setGroupLimit]=useState(20);
 const [filter,setFilter]=useState(''),[error,setError]=useState(''),[exporting,setExporting]=useState(false),[exported,setExported]=useState(false);
 const dialog=useRef<HTMLElement>(null),runId=useRef(''),locked=useRef(false),stopped=useRef(false),mounted=useRef(true),exportLock=useRef(false);
 const collected=useRef<PeopleItem[]>([]),publish=useRef((items:PeopleItem[])=>{});
 publish.current=(items)=>{collected.current=[...new Map([...collected.current,...items].map(item=>[item.id,item])).values()];const classified=classifyDeepNetwork(person,collected.current,!!options.keepSearching);setMatches(classified);setGroups(deepRecordGroups(person,classified,excluded))};
 const selectedTerms=terms.filter(t=>chosen.has(t.id)),plan=useMemo(()=>makeDeepPlan(person,selectedTerms,options,settings),[person,chosen,options,settings]);
 const patchOption=(patch:Partial<DeepOptions>)=>{
  setOptions(old=>({...old,...patch}));
  onOptionsChange(patch);
 };
 useEffect(()=>{mounted.current=true;const off=window.h3x.onDeepProgress?.(p=>{if(p.runId===runId.current){setProgress(p);if(p.items?.length)publish.current(p.items)}});return()=>{mounted.current=false;off?.();if(runId.current)void window.h3x.cancelDeepSearch(runId.current).catch(()=>{})}},[]);
 useEffect(()=>{
  if(!open)return;const previous=document.activeElement as HTMLElement|null;
  dialog.current?.focus();return()=>{if(previous?.isConnected)previous.focus()};
 },[open]);
 async function start(){
  if(locked.current||!plan.tasks.length)return;
  collected.current=[];locked.current=true;stopped.current=false;setPhase('running');setError('');setWarnings([]);setLimited(false);setCanceled(false);setExported(false);setFollowed(0);setRound(0);setGroups([]);setMatches({same:[],related:[],unmatched:[]});setProgress(null);setShowRelated(!!options.related);setShowUnmatched(false);setGroupLimit(20);
  let items:PeopleItem[]=[],messages:string[]=[],isLimited=false,wasCanceled=false;
  try{
   const requests=new Set<string>();
   const execute=async(batch:typeof plan)=>{
    batch=pendingDeepPlan(batch,requests);if(!batch.tasks.length)return;
    runId.current=crypto.randomUUID();setProgress({runId:runId.current,completed:0,total:batch.tasks.length,records:items.length,message:'Starting provider searches'});
    const response=await window.h3x.deepSearch({runId:runId.current,plan:batch});
    runId.current='';publish.current(response.items);items=collected.current;messages.push(...response.warnings);isLimited||=response.limited;wasCanceled||=response.canceled;
   };
   await execute(plan);
   if(options.keepSearching){
    const searched=[...selectedTerms];let count=0;
    while(!stopped.current&&!wasCanceled&&mounted.current){
     const network=classifyDeepNetwork(person,collected.current,true),pending=nextDeepSearchTerms(network,searched);
     if(!pending.length)break;
     if(!options.longSearch&&(count>=10||searched.length>=120||collected.current.length>=5000)){messages.push('Keep searching reached its limit (10 follow-up rounds, 120 identifiers or 5,000 records).');isLimited=true;break}
     const found=pending.slice(0,options.longSearch?12:Math.min(12,120-searched.length));
     searched.push(...found);setFollowed(searched.length-selectedTerms.length);setRound(++count);
     // New contacts belong to their source records; never apply the target's identity filters.
     const batch=makeDeepPlan(person,found,{...options,mode:found.some(t=>['ip','ip_address','adresse_ip'].includes(t.key))?'both':'unfiltered',savedFilters:false},settings);
     if(!batch.tasks.length)break;
     await execute(batch);
    }
   }else if(options.followContacts&&!stopped.current&&!wasCanceled){
    const trusted=classifyDeepHits(person,items),found=discoveredContacts(person,trusted.same,selectedTerms).slice(0,12);
    if(found.length){setFollowed(found.length);setRound(1);await execute(makeDeepPlan(person,found,options,settings))}
   }
   if(!mounted.current)return;
   const classified=classifyDeepNetwork(person,collected.current,!!options.keepSearching);setMatches(classified);setGroups(deepRecordGroups(person,classified,excluded));setPhase('review');
  }catch(e){if(mounted.current){setError(errorText(e));const classified=classifyDeepNetwork(person,collected.current,!!options.keepSearching);setMatches(classified);setGroups(deepRecordGroups(person,classified,excluded));setPhase('review')}}
  finally{runId.current='';locked.current=false;if(mounted.current){setWarnings([...new Set(messages)]);setLimited(isLimited);setCanceled(wasCanceled||stopped.current)}}
 }
 async function stop(){stopped.current=true;try{if(runId.current)await window.h3x.cancelDeepSearch(runId.current)}catch(e){setError(errorText(e))}}
 const activeGroups=groups.filter(group=>group.kind==='same'||group.kind==='related'&&showRelated||group.kind==='unmatched'&&showUnmatched);
 const selectedRows=activeGroups.flatMap(group=>group.rows.filter(row=>row.keep&&row.value.trim())),review=useMemo(()=>reviewedPeople(activeGroups),[groups,showRelated,showUnmatched]);
 const rowMatches=(row:ReviewFact)=>!filter||(row.label+' '+row.value+' '+row.sources.join(' ')).toLowerCase().includes(filter.toLowerCase());
 const visibleRows=(group:DeepReviewGroup)=>group.rows;
 const visibleGroups=activeGroups.filter(group=>!filter||group.person.title.toLowerCase().includes(filter.toLowerCase())||group.rows.some(rowMatches)||group.matches.some(match=>match.reasons.join(' ').toLowerCase().includes(filter.toLowerCase())));
 function updateRows(groupId:string,change:(rows:ReviewFact[])=>ReviewFact[]){setExported(false);setGroups(old=>old.map(group=>group.id===groupId?{...group,rows:change(group.rows)}:group))}
 function keepAll(){const ids=new Set(activeGroups.map(group=>group.id));setExported(false);setGroups(old=>old.map(group=>ids.has(group.id)?{...group,rows:group.rows.map(row=>({...row,keep:!!row.value.trim()}))}:group))}
 function renderRows(group:DeepReviewGroup){const visible=visibleRows(group);return <><div className="deep-report">{visible.map(row=><div className={'deep-fact'+(!row.keep?' deep-fact-muted':'')} key={row.id}>
  <input disabled={phase==='running'} type="checkbox" aria-label={`Keep ${row.label}: ${row.original}`} checked={row.keep} onChange={e=>updateRows(group.id,old=>old.map(r=>r.id===row.id?{...r,keep:e.target.checked}:r))}/>
  <label><span>{row.label}<small>{row.edited?'Edited':row.conflict?'Alternative':row.known?'Starting detail':row.corroborated?'Corroborated':'Single provider'}</small></span><textarea disabled={phase==='running'} rows={1} aria-label={`Edit ${row.label}: ${row.original}`} value={row.value} onChange={e=>updateRows(group.id,old=>old.map(r=>r.id===row.id?{...r,value:e.target.value,edited:true}:r))}/><small className="deep-sources">{new Set(row.sources.map(providerFamily)).size} provider {new Set(row.sources.map(providerFamily)).size===1?'family':'families'} · {row.sources.join(' / ')}</small></label>
  <button disabled={phase==='running'} aria-label={`Delete ${row.label}: ${row.original}`} title="Delete detail from report" onClick={()=>updateRows(group.id,old=>old.filter(r=>r.id!==row.id))}><Trash2 size={14}/></button>
 </div>)}</div>{!visible.length&&<p className="deep-hint">No details match this view.</p>}</>}
 async function exportTxt(){
  if(exportLock.current||!selectedRows.length)return;exportLock.current=true;setExporting(true);setError('');
  try{
   const saved=[];for(const [index,entry] of review.entries()){
    const result=await exportSearchPerson(entry,makePerson(index+1),window.h3x.prepareEvidence,excluded,'Deep search: '+person.title);
    saved.push(result);
   }
   const people=await mergeSavedPeople(saved,window.h3x.prepareEvidence,excluded);
   const now=new Date().toISOString(),record:Case={id:crypto.randomUUID(),title:person.title+' · Deep search',type:'Person',summary:'Reviewed deep-search findings',notes:'',createdAt:now,updatedAt:now,people};
   if(await window.h3x.exportCase({record,excluded}))setExported(true);
  }catch(e){setError(errorText(e))}finally{exportLock.current=false;setExporting(false)}
 }
 if(!open)return null;
 return <div className="modal-backdrop deep-backdrop" onClick={onClose} onKeyDown={event=>{
  if(event.key==='Escape'){event.stopPropagation();onClose()}
  if(event.key==='Tab'){
   const nodes=[...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,textarea:not(:disabled)')||[])].filter(el=>el.checkVisibility()),first=nodes[0],last=nodes.at(-1);
   if(!nodes.includes(document.activeElement as HTMLElement)||event.shiftKey&&document.activeElement===first){event.preventDefault();(event.shiftKey?last:first)?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
  }
 }}><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="deep-title" aria-describedby="deep-description" className="deep-dialog" onClick={e=>e.stopPropagation()}>
  <header className="deep-header"><span className="deep-icon"><ScanSearch size={22}/></span><div><div className="eyebrow">PEOPLE / DEEP SEARCH</div><h2 id="deep-title">{person.title}</h2></div><button aria-label={phase==='running'?'Hide deep search; continue in background':'Close deep search'} onClick={onClose}><X size={18}/></button></header>
  <div className="deep-body">
  {phase==='confirm'&&<>
   <p id="deep-description" className="muted">Search known identifiers with the selected providers.</p>
   <div className="deep-provider-options"><label><input type="checkbox" checked={options.oath} disabled={!credential} onChange={e=>patchOption({oath:e.target.checked})}/><span>OathNet bulk<small>{credential?'Breach identity records':'Add an API key in Settings'}</small></span></label><label><input type="checkbox" checked={options.brix} onChange={e=>patchOption({brix:e.target.checked})}/><span>BrixHub API</span></label><label><input type="checkbox" disabled checked={false} onChange={e=>patchOption({ghunt:e.target.checked})}/><span>GHunt<small>Desktop only</small></span></label></div>
   <div className="deep-options"><label>Search passes<select aria-label="Deep search passes" value={options.mode} onChange={e=>patchOption({mode:e.target.value as DeepOptions['mode']})}><option value="both">With filters + without filters</option><option value="filtered">With identity filters</option><option value="unfiltered">Without filters</option></select></label><label>BrixHub depth<select aria-label="Deep search BrixHub depth" value={options.pages} onChange={e=>patchOption({pages:Number(e.target.value)})}><option value={1}>Up to 100 records per search</option><option value={3}>Up to 300 records per search</option></select></label></div>
   <fieldset className="deep-behavior"><legend>Search options</legend>
    <label className="deep-check"><input type="checkbox" aria-label="Long search" disabled checked={false} onChange={e=>patchOption({longSearch:e.target.checked,...(e.target.checked?{keepSearching:true}:{})})}/><span>Long search<small>Desktop only</small></span></label>
    <label className="deep-check"><input type="checkbox" checked={options.savedFilters} disabled={options.mode==='unfiltered'} onChange={e=>patchOption({savedFilters:e.target.checked})}/><span>Apply saved provider filters</span></label>
    <label className="deep-check"><input type="checkbox" aria-label="Save OathNet searches" checked={options.saveOath!==false} disabled={!options.oath} onChange={e=>patchOption({saveOath:e.target.checked})}/><span>Save OathNet searches<small>One broad OathNet pass when both passes are selected</small></span></label>
    <label className="deep-check"><input type="checkbox" aria-label="Search for related people" checked={!!options.related} onChange={e=>patchOption({related:e.target.checked})}/><span>Find related people</span></label>
    <label className="deep-check"><input type="checkbox" aria-label="Keep searching new information" checked={!!options.keepSearching} disabled={!!options.longSearch} onChange={e=>patchOption({keepSearching:e.target.checked})}/><span>Follow new emails, phones and addresses</span></label>
    {!options.keepSearching&&<label className="deep-check"><input type="checkbox" checked={options.followContacts} onChange={e=>patchOption({followContacts:e.target.checked})}/><span>Follow new contacts once</span></label>}
   </fieldset>
   {options.keepSearching&&<p className="deep-hint">{options.longSearch?'Search until no new identifiers remain. Stop at any time.':'Up to 10 follow-up rounds / 120 identifiers.'}</p>}
   <div className="deep-section-title"><h3>Identifiers to search</h3><span>{selectedTerms.length} / 24 selected</span></div>
   
   <div className="deep-terms">{terms.map(term=><label key={term.id}><input type="checkbox" checked={chosen.has(term.id)} disabled={!chosen.has(term.id)&&chosen.size>=24} onChange={()=>setChosen(old=>{const next=new Set(old);next.has(term.id)?next.delete(term.id):next.add(term.id);return next})}/><small>{term.label}</small><span>{term.value}</span></label>)}</div>
   {!terms.length&&<p className="deep-alert">This person has no supported identifier to search.</p>}
   <details className="deep-plan"><summary>Preview {plan.tasks.length} search tasks<ChevronRight size={13}/></summary>{plan.tasks.map((task,i)=><div key={i}><b>{task.provider==='oathnet'?`OathNet bulk · ${task.terms?.length} terms`:task.provider==='ghunt'?`GHunt · ${task.query}`:`BrixHub · ${task.query}`}</b><small>{task.filtered?'Filtered':'Unfiltered'}{Object.keys(task.filters).length?' · '+Object.keys(task.filters).join(', '):''}</small></div>)}</details>
   <p className="deep-hint">{plan.tasks.length} search tasks · Provider quotas apply.</p>
  </>}
  {phase==='running'&&<div className="deep-running" role="status" aria-live="polite"><span className="search-spinner"/><h3>{followed?`Following new information · round ${round}`:'Searching known identifiers'}</h3><p>{progress?.message||'Starting deep search'}</p><progress value={progress?.completed||0} max={progress?.total||1}/><small>{progress?.completed||0} / {progress?.total||plan.tasks.length} tasks · {progress?.records||0} records collected</small></div>}
  {phase!=='confirm'&&<>
   <p id="deep-description" className="muted">Only checked details will be saved or exported.</p>
   <div className="deep-stats"><div><b>{matches.same.length}</b><span>same-person matches</span></div><div><b>{matches.related.length}</b><span>possible connections</span></div><div><b>{matches.unmatched.length}</b><span>unmatched records</span></div></div>
   {(canceled||limited||warnings.length>0)&&<div className="deep-alert" role="status">{canceled&&<p>Search stopped. Review contains the completed results.</p>}{limited&&<p>Some searches reached the record limit. These findings cover the retrieved records.</p>}{warnings.length>0&&<details><summary>{warnings.length} provider {warnings.length===1?'issue':'issues'} · results may be incomplete</summary>{warnings.map((warning,i)=><p key={i}>{warning}</p>)}</details>}</div>}
   {phase==='review'&&!matches.same.length&&<p className="deep-alert">No new same-person matches. Possible connections and unmatched records remain available for review.</p>}
   {followed>0&&<p className="deep-hint">Followed {followed} new identifiers across {round} {round===1?'round':'rounds'}.</p>}
   <label className="deep-review-filter"><Search size={15}/><input aria-label="Filter deep search findings" placeholder="Filter findings, labels, or sources" value={filter} onChange={e=>setFilter(e.target.value)}/></label>
   <label className="deep-check"><input type="checkbox" aria-label="Show related people" checked={showRelated} onChange={e=>{setShowRelated(e.target.checked);setExported(false)}}/> Show related people and possible connections ({matches.related.length} records)</label>
   <label className="deep-check"><input type="checkbox" aria-label="Show unmatched information" checked={showUnmatched} onChange={e=>{setShowUnmatched(e.target.checked);setExported(false)}}/> Show unmatched information ({matches.unmatched.length} records)</label>
   <div className="deep-bulk-actions"><button disabled={phase==='running'} onClick={keepAll}>Keep all found information</button><span>{selectedRows.length} details · {review.length} {review.length===1?'person':'people'} selected</span></div>
   <div className="deep-section-title"><h3>Found people</h3><span>{visibleGroups.length} {visibleGroups.length===1?'person':'people'}</span></div>
   <div className="deep-result-cards">{visibleGroups.slice(0,groupLimit).map(group=><article className={'deep-result-card deep-kind-'+group.kind} data-deep-kind={group.kind} key={group.id}>
    <header><div><small>{[...new Set(group.person.items.map(item=>item.source))].join(' / ')}</small><h3>{group.person.title}</h3></div><CountryBadge fields={group.person.items.map(item=>item.fields)}/></header>
    <div className="deep-card-classification">{group.kind==='same'?'Same-person match':group.kind==='related'?'Possible connection':'Unmatched information'}<span>{group.rows.filter(row=>row.keep).length} details kept</span></div>
    {group.matches.some(match=>match.familyLinks?.length)&&<div className="deep-family"><b>Possible family</b>{group.matches.flatMap(match=>match.familyLinks||[]).map(link=><span key={link.personId}>{link.title} · Same surname · {link.basis.join(' / ')}</span>)}</div>}
    <div className="deep-correlation-reasons">{[...new Set(group.matches.flatMap(match=>match.reasons))].map(reason=><span key={reason}>{reason}</span>)}</div>
    {group.matches.some(match=>match.conflicts.length>0)&&<p className="deep-hint">{group.matches.flatMap(match=>match.conflicts).join(' · ')}</p>}
    <label className="deep-check"><input disabled={phase==='running'} type="checkbox" aria-label={`Include card for ${group.person.title} from ${group.person.items[0]?.source}`} checked={group.rows.some(row=>row.keep)} onChange={e=>updateRows(group.id,old=>old.map(row=>({...row,keep:e.target.checked&&!!row.value.trim()})))}/> Include this card</label>
    <details className="deep-card-details"><summary>Details <span>{group.rows.length}</span></summary>{renderRows(group)}</details>
   </article>)}</div>
   {!visibleGroups.length&&<p className="deep-hint">{phase==='running'?'Waiting for matching records...':'No cards match this view.'}</p>}
   {visibleGroups.length>groupLimit&&<button onClick={()=>setGroupLimit(limit=>limit+20)}>Show 20 more cards ({visibleGroups.length-groupLimit} remaining)</button>}

  </>}
  {error&&<p role="alert" className="deep-alert"><AlertCircle size={14}/>{error}</p>}
  {exported&&<p role="status" className="deep-hint">Selected cards exported.</p>}
  </div>
  <footer className="deep-footer">
   {phase==='confirm'&&<><button onClick={onClose}>Cancel</button><button className="primary deep-confirm" disabled={!selectedTerms.length||!plan.tasks.length} onClick={start}><ScanSearch size={15}/> Confirm deep search</button></>}
   {phase==='running'&&<><button onClick={onClose}>Hide search</button><button className="deep-stop" onClick={stop}><Square size={13}/> Stop & review</button></>}
   {phase==='review'&&<><button aria-label="Discard deep search report" onClick={onDiscard}><Trash2 size={14}/> Discard</button><button onClick={()=>{setPhase('confirm');setError('');setExported(false)}}>Search again</button><span/><button disabled={!selectedRows.length||exporting} onClick={exportTxt}><Download size={14}/>{exporting?'Exporting...':'Export TXT'}</button><button className="primary" disabled={!selectedRows.length||exporting} onClick={()=>onSave(review)}><FolderPlus size={14}/> Save to investigation</button></>}
  </footer>
 </section></div>;
}
