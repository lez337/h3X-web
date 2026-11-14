import {useEffect,useRef,useState} from 'react';
import type {Person} from './Investigations';
import {mergeInvestigationPeople} from './investigationMerge';
import {X} from 'lucide-react';

export default function InvestigationMergeDialog({target,people,onMerge,onClose}:{target:Person;people:Person[];onMerge:(source:Person,merged:Person)=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [sourceId,setSourceId]=useState('');
 const source=people.find(p=>p.id===sourceId&&p.id!==target.id);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>{dialog.current?.close();previous?.focus()}},[]);
 return <dialog ref={dialog} className="search-settings-dialog investigation-merge-dialog" aria-labelledby="merge-title" onCancel={e=>{e.preventDefault();onClose()}}>
  <header className="search-settings-header"><div><div className="eyebrow">INVESTIGATION</div><h2 id="merge-title">Merge into {target.name||'Unnamed person'}</h2></div><button type="button" aria-label="Close merge" onClick={onClose}><X size={18}/></button></header>
  <div className="search-settings-body"><label>Person to merge<select autoFocus value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">Choose a person</option>{people.filter(p=>p.id!==target.id).map(p=><option key={p.id} value={p.id}>{p.name||'Unnamed person'}{p.email?' · '+p.email:''}</option>)}</select></label>
  <p className="muted">Keeps this person's details, combines contacts, notes and saved records, and preserves conflicting values in additional details.</p>
  {source&&<div className="merge-preview"><strong>{source.name||'Unnamed person'} → {target.name||'Unnamed person'}</strong><p>The two folders will become one.</p></div>}</div>
  <footer className="search-settings-footer"><button type="button" onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={!source} onClick={()=>{if(source)onMerge(source,mergeInvestigationPeople(target,source))}}>Merge people</button></footer>
 </dialog>;
}
