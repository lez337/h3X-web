import PeopleGoogle from './PeopleGoogle';
import CountryBadge from './CountryBadge';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Users,Search,Info,ChevronRight,AlertCircle,FolderPlus,SlidersHorizontal,X,Check,ArrowDownAZ,ScanSearch} from 'lucide-react';
import {groupPeople,normalizeBirthDate,type PeopleItem,type PersonDetail,type SearchPerson} from './peopleModel';
import {matchesPeopleQuery,parsePeopleQuery,peopleCommands,peopleHighlightIndices,searchText,type PeopleQuery} from './peopleQuery';
import './people.css';

function Highlight({value,query,field}:{value:string;query:PeopleQuery;field?:string}){
 const indices=peopleHighlightIndices(value,query,field);
 if(!indices.size)return <>{value}</>;
 const parts:{text:string;hit:boolean}[]=[];
 for(let i=0;i<value.length;i++){const hit=indices.has(i),last=parts.at(-1);if(last&&last.hit===hit)last.text+=value[i];else parts.push({text:value[i],hit})}
 return <>{parts.map((part,i)=>part.hit?<mark key={i}>{part.text}</mark>:<span key={i}>{part.text}</span>)}</>;
}
function Detail({detail:d,query}:{detail:PersonDetail;query:PeopleQuery}){
 return <div className={'people-detail'+(d.conflict?' people-detail-conflict':'')}><dt>{d.label}{d.conflict&&<span>Alternative</span>}</dt><dd><span><Highlight value={d.value} query={query} field={d.key}/></span><details className="people-confidence"><summary aria-label={`${d.label}: ${d.confidence}% confidence. Show supporting sources`} title={d.explanation}>{d.confidence}%</summary><div><p>{d.explanation}</p>{d.sources.map(source=><small key={source}>{source}</small>)}</div></details></dd></div>;
}
const identity=new Set(['name','first_name','last_name','date_of_birth','age','tax_code']);
const contacts=new Set(['email','phone','username']);
const location=new Set(['address','city','postal_code','country']);
function personAge(person:SearchPerson){
 const birth=person.details.find(d=>d.key==='date_of_birth'&&!d.conflict&&normalizeBirthDate(d.value));
 if(birth){const [year,month,day]=normalizeBirthDate(birth.value).split('-').map(Number),today=new Date();return String(today.getUTCFullYear()-year-(today.getUTCMonth()+1<month||(today.getUTCMonth()+1===month&&today.getUTCDate()<day)?1:0))}
 return person.details.find(d=>d.key==='age'&&!d.conflict&&/^\d{1,3}$/.test(d.value))?.value;
}
function personPhoto(person:SearchPerson):string|undefined{
 function find(value:unknown,depth=0):string|undefined{
  if(!value||typeof value!=='object'||depth>8)return;
  for(const [key,child] of Object.entries(value)){
   if(/^(?:avatar(?:_?url)?|photo(?:_?url)?|picture(?:_?url)?|profile_?(?:photo|picture)(?:_?url)?)$/i.test(key)&&typeof child==='string'){
    try{const url=new URL(child);if(url.protocol==='https:'&&!url.username&&!url.password)return url.href}catch{}
   }
  }
  for(const child of Object.values(value)){const result=find(child,depth+1);if(result)return result}
 }
 for(const item of person.items){const result=find(item.fields);if(result)return result}
}
function PersonAvatar({person}:{person:SearchPerson}){
 const url=personPhoto(person),[failed,setFailed]=useState<string>();
 return <span className="people-avatar" aria-hidden="true">{url&&failed!==url?<img src={url} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(url)}/>:person.title.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()}</span>;
}
function PersonCard({person,query,selected,onSelect,onShowRecord,onExport,onOpen,onDeepSearch}:{person:SearchPerson;query:PeopleQuery;selected:boolean;onSelect:()=>void;onShowRecord:(id:string)=>void;onExport:()=>void;onOpen:(url:string)=>void;onDeepSearch:()=>void}){
 const sections=[{name:'Identity',details:person.details.filter(d=>identity.has(d.key)&&!(d.key==='name'&&d.value===person.title&&!d.conflict))},{name:'Contact',details:person.details.filter(d=>contacts.has(d.key))},{name:'Location',details:person.details.filter(d=>location.has(d.key))}].filter(s=>s.details.length);
 const other=person.details.filter(d=>!identity.has(d.key)&&!contacts.has(d.key)&&!location.has(d.key)&&!((d.key==='play_games'||d.key.startsWith('play_games.')||d.key==='profile_url')&&d.recordIds.every(id=>person.items.some(item=>item.id===id&&item.profileType==='google'))));
 const sources=[...new Set(person.items.map(item=>item.source))];
 const nameDetail=person.details.find(d=>d.key==='name'&&d.value===person.title);
 const showOther=other.some(d=>peopleHighlightIndices(d.value,query,d.key).size>0||query.clauses.some(c=>!c.exclude&&c.command==='text'&&searchText(d.label).includes(searchText(c.value))));
 const age=personAge(person),email=person.details.find(d=>d.key==='email')?.value;
 return <article id={'search-person-'+encodeURIComponent(person.id)} tabIndex={-1} className={'people-card'+(selected?' people-card-selected':'')}>
  <input className="people-select" type="checkbox" aria-label={`Select ${person.title}`} checked={selected} onChange={onSelect}/>
  <details className="people-dropdown" open={showOther||undefined}>
   <summary className="people-identity" aria-label={`Details for ${person.title}`}><PersonAvatar person={person}/><div><h4><Highlight value={person.title} query={query} field="name"/></h4><span className="people-summary-email" title={email}><Highlight value={email||'Email unavailable'} query={query} field="email"/></span><span className="people-summary-age">{age?age+' years old':'Age unavailable'}</span></div><span className="people-card-meta"><CountryBadge fields={person.items.map(item=>item.fields)}/><ChevronRight className="people-expand-icon" size={14}/></span></summary>
   <div className="people-card-body">
    <div className="people-expanded-meta"><small>{person.items.length} {person.items.length===1?'record':'records'} combined</small><span className="people-match" title="Heuristic support that these records describe one person; not a verified probability"><b>{person.confidence}%</b><small>match</small></span></div>
    {nameDetail&&<details className="people-name-support"><summary aria-label={`Full name: ${nameDetail.confidence}% confidence. Show supporting sources`}>Name support {nameDetail.confidence}%</summary><p>{nameDetail.explanation}</p>{nameDetail.sources.map(source=><small key={source}>{source}</small>)}</details>}
  <div className="people-reasons">{person.matchReasons.length?person.matchReasons.map(reason=><span key={reason}><Check size={10}/>{reason}</span>):<span>Single record · unconfirmed</span>}</div>
  {person.warnings.length>0&&<details className="people-warnings"><summary><AlertCircle size={12}/>{person.warnings.length===1?'Matching caution':`${person.warnings.length} matching cautions`}</summary>{person.warnings.map(warning=><p className="people-warning" key={warning}>{warning}</p>)}</details>}
  {sections.map(section=>{const fields=<dl className="people-details">{section.details.map(d=><Detail key={d.key+'\0'+d.value} detail={d} query={query}/>)}</dl>;return section.name==='Identity'||section.name==='Contact'?<details className="people-section people-more" key={section.name}><summary>{section.name} <span>{section.details.length}</span></summary>{fields}</details>:<section className="people-section" key={section.name}><h5>{section.name}</h5>{fields}</section>})}
  {other.length>0&&<details className="people-section people-more" open={showOther||undefined}><summary>More details <span>{other.length}</span></summary><dl className="people-details">{other.map(d=><Detail key={d.key+'\0'+d.value} detail={d} query={query}/>)}</dl></details>}
  <PeopleGoogle items={person.items} onOpen={onOpen}/>
  <details className="people-records"><summary>Source records <span>{person.items.length}</span></summary><div className="people-source-tags">{sources.map(source=><span key={source}>{source}</span>)}</div>{person.items.map((item,i)=><button type="button" key={item.id} onClick={()=>onShowRecord(item.id)}><span>{item.source}<small>Record {i+1}</small></span><ChevronRight size={13}/></button>)}</details>
  <button className="people-deep-button" onClick={onDeepSearch}><ScanSearch size={14}/> Deep search</button>
  <button className="people-export" onClick={onExport}><FolderPlus size={14}/> Save to investigation<ChevronRight size={13}/></button>
   </div>
  </details>
 </article>;
}

export default function PeopleCards({items,focusPerson,onShowRecord,onExport,onOpen,onDeepSearch}:{items:PeopleItem[];focusPerson?:{id:string}|null;onShowRecord:(id:string)=>void;onExport:(people:SearchPerson[])=>void;onOpen:(url:string)=>void;onDeepSearch:(person:SearchPerson)=>void}){
 const people=useMemo(()=>groupPeople(items),[items]),[filter,setFilter]=useState(''),[guide,setGuide]=useState(false),[sort,setSort]=useState('records'),[selection,setSelection]=useState<Set<string>>(new Set());
 const input=useRef<HTMLInputElement>(null),query=useMemo(()=>parsePeopleQuery(filter),[filter]);
 const visible=useMemo(()=>people.filter(p=>matchesPeopleQuery(p,query)).sort((a,b)=>sort==='name'?a.title.localeCompare(b.title):sort==='confidence'?b.confidence-a.confidence||a.title.localeCompare(b.title):b.items.length-a.items.length||a.title.localeCompare(b.title)),[people,query,sort]);
 useEffect(()=>{
  if(!focusPerson||!people.some(person=>person.id===focusPerson.id))return;
  setFilter('');
  const frame=requestAnimationFrame(()=>{
   const card=document.getElementById('search-person-'+encodeURIComponent(focusPerson.id));
   if(!card)return;
   card.querySelector('details.people-dropdown')?.setAttribute('open','');
   card.scrollIntoView({behavior:'smooth',block:'center'});card.focus({preventScroll:true});
  });
  return()=>cancelAnimationFrame(frame);
 },[focusPerson,people]);
 const selected=people.filter(p=>selection.has(p.id)),allVisible=visible.length>0&&visible.every(p=>selection.has(p.id));
 const activeCommand=filter.match(/(?:^|\s)\/([a-z]*)$/i),suggestions=activeCommand?peopleCommands.filter(c=>c.name.startsWith(activeCommand[1].toLowerCase())):[];
 function insertCommand(name:string){setFilter(value=>activeCommand?value.slice(0,value.length-activeCommand[0].length)+(activeCommand[0].startsWith(' ')?' ':'')+`/${name} `:(value.trim()?value.trim()+' ':'')+`/${name} `);input.current?.focus()}
 const toggle=(id:string)=>setSelection(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next});
 return <section className="people-panel liquid-glass" aria-labelledby="people-title">
  <header className="people-heading"><span className="people-icon"><Users size={19}/></span><div><h3 id="people-title">People</h3></div><span className="people-count" aria-label={`${people.length} people`}>{people.length}</span></header>
  <div className="people-search-area"><label className={'people-filter'+(query.error?' people-filter-invalid':'')}><Search size={14}/><input ref={input} aria-label="Filter people" aria-invalid={!!query.error} aria-describedby={query.error?'people-query-error':undefined} placeholder={'Search details or /inname "alx"'} value={filter} onChange={e=>setFilter(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){setFilter('');setGuide(false)}if(e.key==='Enter'&&suggestions.length===1){e.preventDefault();insertCommand(suggestions[0].name)}}}/>{filter&&<button aria-label="Clear people filter" onClick={()=>{setFilter('');input.current?.focus()}}><X size={13}/></button>}<button className={guide?'active':''} aria-label="People search command guide" aria-expanded={guide} onClick={()=>setGuide(!guide)}><SlidersHorizontal size={14}/></button></label>
   
   {suggestions.length>0&&<div className="people-suggestions" aria-label="Suggested commands">{suggestions.map(c=><button key={c.name} onClick={()=>insertCommand(c.name)}><code>/{c.name}</code><span>{c.description}</span></button>)}</div>}
   {query.error&&<p id="people-query-error" className="people-query-error" role="status"><AlertCircle size={12}/>{query.error}</p>}
   {guide&&<div className="people-command-guide"><div><b>Filter your people</b><button aria-label="Close command guide" onClick={()=>setGuide(false)}><X size={13}/></button></div><p>Combine filters with spaces. Every filter must match. Add <code>-</code> before a command to exclude matches.</p>{peopleCommands.map(c=><button key={c.name} onClick={()=>insertCommand(c.name)}><code>{c.example}</code><small>{c.description}</small></button>)}<p><code>/inname "alx" /has email -/address "paris"</code></p><p>/inname matches any letters you enter in order, even with gaps (for example, "alx" matches "Alex"). Matching ignores case and accents. Other text filters match consecutive text.</p></div>}
  </div>
  <div className="people-toolbar"><label><input type="checkbox" aria-label="Select all visible people" checked={allVisible} ref={el=>{if(el)el.indeterminate=!allVisible&&visible.some(p=>selection.has(p.id))}} disabled={!visible.length} onChange={()=>setSelection(old=>{const next=new Set(old);visible.forEach(p=>allVisible?next.delete(p.id):next.add(p.id));return next})}/><span aria-live="polite">{visible.length} of {people.length}</span></label><label className="people-sort"><ArrowDownAZ size={12}/><select aria-label="Sort people" value={sort} onChange={e=>setSort(e.target.value)}><option value="records">Most records</option><option value="name">Name A–Z</option><option value="confidence">Match score</option></select></label></div>
  {selected.length>0&&<div className="people-selection-bar"><span>{selected.length} selected{selected.some(p=>!visible.includes(p))?' (includes hidden)':''}</span><button onClick={()=>onExport(selected)}><FolderPlus size={13}/> Save selected</button><button aria-label="Clear people selection" onClick={()=>setSelection(new Set())}><X size={13}/></button></div>}
  <div className="people-list">{visible.map(person=><PersonCard key={person.id} person={person} query={query} selected={selection.has(person.id)} onSelect={()=>toggle(person.id)} onShowRecord={onShowRecord} onExport={()=>onExport([person])} onOpen={onOpen} onDeepSearch={()=>onDeepSearch(person)}/>)}</div>
  {!people.length&&<p className="people-empty">No people found.</p>}
  {!!people.length&&!visible.length&&<div className="people-empty"><Search size={22}/><b>{query.error?'Finish your filter':'No matching people'}</b><p>{query.error?'Use the command guide for examples.':'Try fewer filters or a shorter name.'}</p><button onClick={()=>{setFilter('');input.current?.focus()}}>Clear filter</button></div>}
  <details className="people-help"><summary><Info size={12}/> About matching & scores</summary><p>Exact emails, normalized phones, or a matching full name and birth date link records. Name matching ignores case, accents, and name order. Names or dates alone never merge people. Conflicting birth dates stay separate. Only visible search results are grouped.</p><p>Field support starts at 50% for one provider family and adds 15 points per additional family, up to 95%. Repeated records from the same family add no support. Alternatives lose 20 points.</p><p>Record-match support starts at 35% for one record; shared phones or a matching full name with birth date start at 70%, emails 80%, both contacts 90%. Agreeing birth dates add 5; cautions subtract 15. Scores describe supporting evidence, not verified probabilities.</p></details>
 </section>;
}
