import {useEffect,useRef,useState} from 'react';
import {FolderPlus,X} from 'lucide-react';
import type {SearchPerson} from './peopleModel';
import type {Case} from './Investigations';

export type PeopleSaveTarget={caseId:string;personId:string;title:string;openAfter:boolean};
export default function PeopleSaveDialog({people,cases,defaultCase,onClose,onSave}:{people:SearchPerson[];cases:Case[];defaultCase:string;onClose:()=>void;onSave:(target:PeopleSaveTarget)=>Promise<void>}){
 const [caseId,setCaseId]=useState(cases.some(c=>c.id===defaultCase)?defaultCase:''),[personId,setPersonId]=useState(''),[title,setTitle]=useState(people.length===1?people[0].title:'People investigation'),[openAfter,setOpenAfter]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLElement>(null),locked=useRef(false);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  dialog.current?.querySelector<HTMLElement>('select')?.focus();
  return()=>{if(previous?.isConnected)previous.focus()};
 },[]);
 async function save(){if(locked.current)return;locked.current=true;setSaving(true);setError('');try{await onSave({caseId,personId,title:title.trim()||'People investigation',openAfter})}catch(e){setError(e instanceof Error?e.message:String(e))}finally{locked.current=false;setSaving(false)}}
 return <div className="modal-backdrop" onClick={()=>!saving&&onClose()} onKeyDown={e=>{
  if(e.key==='Escape'&&!saving){e.stopPropagation();onClose()}
  if(e.key==='Tab'){
   const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)')||[]),first=nodes[0],last=nodes.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
  }
 }}><section ref={dialog} className="save-dialog people-save-dialog" role="dialog" aria-modal="true" aria-labelledby="people-save-title" aria-busy={saving} onClick={e=>e.stopPropagation()}>
  <div className="eyebrow">PEOPLE / INVESTIGATIONS</div><h2 id="people-save-title">Save {people.length===1?'person':`${people.length} people`}</h2>
  <div className="people-save-preview">{people.map(person=><div key={person.id}><b>{person.title}</b><small>{person.items.length} {person.items.length===1?'record':'records'}</small></div>)}</div>
  <label>Investigation<select aria-label="People export investigation" value={caseId} disabled={saving} onChange={e=>{setCaseId(e.target.value);setPersonId('')}}><option value="">Create new investigation</option>{cases.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
  {!caseId&&<label>Investigation name<input aria-label="New investigation name" value={title} maxLength={160} disabled={saving} onChange={e=>setTitle(e.target.value)}/></label>}
  {people.length===1&&caseId&&<label>Person folder<select aria-label="People export person folder" value={personId} disabled={saving} onChange={e=>setPersonId(e.target.value)}><option value="">Create new person folder</option>{(cases.find(c=>c.id===caseId)?.people||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
  <label className="people-open-after"><input type="checkbox" checked={openAfter} disabled={saving} onChange={e=>setOpenAfter(e.target.checked)}/> Open investigation after saving</label>
  {error&&<p role="alert" className="people-save-error">Save failed: {error}</p>}
  <div className="button-row"><button disabled={saving} onClick={onClose}><X size={14}/> Cancel</button><button className="primary people-confirm-save" disabled={saving} onClick={save}><FolderPlus size={15}/>{saving?'Saving…':'Save to investigation'}</button></div>
 </section></div>;
}
