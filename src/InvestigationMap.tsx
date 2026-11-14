import {useEffect,useMemo,useRef,useState} from 'react';
import './mapRuntime';
import {Map as GlobeMap,Marker,Popup,NavigationControl} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {ExternalLink,FolderOpen,Globe,MapPin,Pause,Play,RotateCcw,Trash2} from 'lucide-react';
import type {Case} from './Investigations';
import {investigationLocations,type InvestigationLocation} from './investigationLocations';
import './investigation-map.css';

type Pin={id:string;name:string;lat:number;lng:number;note:string;caseId?:string};
type Located=InvestigationLocation&{lat:number;lng:number};
type Point={lat:number;lng:number;locations:Located[];pins:Pin[]};
type Props={cases:Case[];pins:Pin[];hiddenFields:string[];focusPin?:string;locationQuery?:string;onOpenCase:(id:string,personId?:string)=>void;onAdd:(pin:Pin)=>void;onRemove:(id:string)=>void;openExternal:(url:string)=>void};
const validPoint=(p:{lat:number;lng:number})=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
const globeZoom=(element:HTMLElement|null)=>Math.log2(Math.max(160,Math.min(element?.clientWidth||600,element?.clientHeight||600)*0.76)*Math.PI/512);
// A subtle local grid keeps the globe usable while map tiles are loading or offline.
const gridLines:number[][][]=[];
for(let lat=-75;lat<=75;lat+=15)gridLines.push(Array.from({length:181},(_,i)=>[-180+i*2,lat]));
for(let lng=-180;lng<180;lng+=15)gridLines.push(Array.from({length:91},(_,i)=>[lng,-90+i*2]));

export default function InvestigationMap(props:Props){
 const {cases,pins,hiddenFields,focusPin,locationQuery,onOpenCase,onAdd,onRemove,openExternal}=props;
 const container=useRef<HTMLDivElement>(null),map=useRef<GlobeMap|null>(null),popup=useRef<Popup|null>(null),preview=useRef<Marker|null>(null),callbacks=useRef(props);
 callbacks.current=props;
 const [ready,setReady]=useState(false),[spinning,setSpinning]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches),[error,setError]=useState('');
 const [located,setLocated]=useState<Located[]>([]),[failed,setFailed]=useState<string[]>([]),[progress,setProgress]=useState(0),[retry,setRetry]=useState(0);
 const [query,setQuery]=useState(''),[caseId,setCaseId]=useState(''),[finding,setFinding]=useState(false),[lookupError,setLookupError]=useState(''),[draft,setDraft]=useState<Pin|null>(null),[selected,setSelected]=useState<Pin|null>(null);
 const lookupVersion=useRef(0),geocoded=useRef(new Map<string,{lat:number;lng:number}|null>()),rotating=useRef(spinning);
 rotating.current=spinning;
 const locations=useMemo(()=>investigationLocations(cases,hiddenFields),[cases,hiddenFields]);
 const caseTitles=useMemo(()=>new Map(cases.map(c=>[c.id,c.title])),[cases]);

 useEffect(()=>{
  if(!container.current)return;
  let instance:GlobeMap;
  try{
   instance=new GlobeMap({container:container.current,center:[10,20],zoom:globeZoom(container.current),minZoom:-1,maxZoom:18,attributionControl:{compact:true},style:{version:8,projection:{type:'globe'},sky:{'sky-color':'#050505','horizon-color':'#454545','fog-color':'#090909','atmosphere-blend':0.2},sources:{earth:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'},grid:{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'MultiLineString',coordinates:gridLines}}}},layers:[{id:'earth-background',type:'background',paint:{'background-color':'#0b0b0b'}},{id:'earth',type:'raster',source:'earth',paint:{'raster-saturation':-1,'raster-brightness-min':0.015,'raster-brightness-max':0.24,'raster-contrast':0.2}},{id:'globe-grid',type:'line',source:'grid',paint:{'line-color':'#888888','line-width':0.5,'line-opacity':['interpolate',['linear'],['zoom'],0,0.17,4,0.08,6,0]}}]}});
   map.current=instance;
   setReady(true);
   instance.addControl(new NavigationControl({showCompass:true}),'top-right');
   instance.on('load',()=>setReady(true));
   instance.on('error',event=>{if(event.error)setError('Globe tiles could not load. Check your connection.');});
   instance.on('sourcedata',event=>{if(event.sourceId==='earth'&&event.isSourceLoaded)setError('');});
   instance.on('mousedown',()=>setSpinning(false));
   instance.on('touchstart',()=>setSpinning(false));
   instance.on('wheel',()=>setSpinning(false));
   instance.on('movestart',event=>{if(event.originalEvent)setSpinning(false);});
  }catch{setError('The 3D globe could not start. Check that graphics acceleration is available.');return;}
  const observer=new ResizeObserver(()=>instance.resize());observer.observe(container.current);
  let frame=0,last=0;
  const spin=(time:number)=>{
   const elapsed=last?Math.min(time-last,64):0;last=time;
   if(rotating.current&&!instance.isMoving()&&instance.getZoom()<5){const center=instance.getCenter();instance.jumpTo({center:[center.lng+elapsed*0.003,center.lat]});}
   frame=requestAnimationFrame(spin);
  };
  frame=requestAnimationFrame(spin);
  return()=>{lookupVersion.current++;cancelAnimationFrame(frame);observer.disconnect();popup.current?.remove();preview.current?.remove();instance.remove();map.current=null;};
 },[]);

 useEffect(()=>{
  let active=true;
  setLocated([]);setFailed([]);setProgress(0);
  (async()=>{
   for(const entry of locations){
    if(!active)return;
    try{
     let point=geocoded.current.get(entry.id);
     if(point===undefined||(retry>0&&point===null)){point=await window.h3x.geocode(entry.address,retry>0);if(!active)return;geocoded.current.set(entry.id,point);}
     if(point&&validPoint(point))setLocated(previous=>[...previous,{...entry,...point}]);
     else setFailed(previous=>[...previous,entry.address]);
    }catch{if(!active)return;setFailed(previous=>[...previous,entry.address]);}
    if(active)setProgress(previous=>previous+1);
   }
  })();
  return()=>{active=false;};
 },[locations,retry]);

 function fly(point:{lat:number;lng:number},zoom=5){setSpinning(false);map.current?.flyTo({center:[point.lng,point.lat],zoom,duration:1000});}
 useEffect(()=>{
  const instance=map.current;if(!ready||!instance)return;
  const groups=new Map<string,Point>();
  for(const point of [...located,...pins]){
   if(!validPoint(point))continue;
   const key=`${point.lat.toFixed(5)},${point.lng.toFixed(5)}`,group=groups.get(key)||{lat:point.lat,lng:point.lng,locations:[],pins:[]};
   if('members' in point)group.locations.push(point);else group.pins.push(point);
   groups.set(key,group);
  }
  const markers:Marker[]=[];
  groups.forEach(group=>{
   const owners=[...new Set([...group.locations.flatMap(l=>l.members.map(m=>m.caseId)),...group.pins.map(p=>p.caseId).filter((id):id is string=>!!id)])];
   const button=document.createElement('button');button.className='investigation-globe-marker location-marker';
   button.title=group.locations[0]?.address||group.pins[0]?.name;
   button.setAttribute('aria-label',`${button.title}: ${owners.length} investigations`);
   const dot=document.createElement('span');dot.className='globe-point';button.append(dot);
   if(owners.length>1){const count=document.createElement('span');count.className='location-marker-count';count.textContent=String(owners.length);button.append(count);}
   button.onclick=event=>{
    event.stopPropagation();fly(group,Math.max(instance.getZoom(),5));popup.current?.remove();setSelected(null);
    const content=document.createElement('div');content.className='location-popup investigation-location-popup';
    const title=document.createElement('b');title.textContent=button.title;content.append(title);
    const members=new Set<string>();
    for(const location of group.locations)for(const member of location.members){
     const key=JSON.stringify([member.caseId,member.personId]);if(members.has(key))continue;members.add(key);
     const open=document.createElement('button');open.textContent=`${caseTitles.get(member.caseId)||'Investigation'} · ${member.name}`;open.onclick=()=>callbacks.current.onOpenCase(member.caseId,member.personId);content.append(open);
    }
    for(const pin of group.pins){const open=document.createElement('button');open.textContent=pin.name;open.onclick=()=>setSelected(pin);content.append(open);}
    if(!group.locations.length&&group.pins.length===1)setSelected(group.pins[0]);
    popup.current=new Popup({offset:16,maxWidth:'340px',closeOnMove:false}).setLngLat([group.lng,group.lat]).setDOMContent(content).addTo(instance);
   };
   markers.push(new Marker({element:button,anchor:'center',opacityWhenCovered:0,subpixelPositioning:true}).setLngLat([group.lng,group.lat]).addTo(instance));
  });
  return()=>{markers.forEach(marker=>marker.remove());popup.current?.remove();};
 },[ready,located,pins,caseTitles]);

 useEffect(()=>{const pin=pins.find(p=>p.id===focusPin);if(pin&&ready){fly(pin);setSelected(pin);}},[focusPin,pins,ready]);
 async function locate(address:string){
  const version=++lookupVersion.current;setFinding(true);setLookupError('');setDraft(null);preview.current?.remove();
  try{
   const coordinates=address.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
   const point=coordinates?{lat:Number(coordinates[1]),lng:Number(coordinates[2])}:await window.h3x.geocode(address);
   if(version!==lookupVersion.current)return;
   if(!point||!validPoint(point)){setLookupError('No map match found for this location.');return;}
   const pin={id:crypto.randomUUID(),name:address,lat:point.lat,lng:point.lng,note:''};
   setDraft(pin);fly(point,10);
   if(map.current)preview.current=new Marker({color:'#dddddd'}).setLngLat([point.lng,point.lat]).addTo(map.current);
  }catch{if(version===lookupVersion.current)setLookupError('Location lookup failed. Try again.');}
  finally{if(version===lookupVersion.current)setFinding(false);}
 }
 useEffect(()=>{if(locationQuery&&ready){setQuery(locationQuery);void locate(locationQuery);}},[locationQuery,ready]);
 const mappedCases=new Set([...located.flatMap(l=>l.members.map(m=>m.caseId)),...pins.filter(validPoint).map(p=>p.caseId)].filter(id=>id&&caseTitles.has(id)));
 return <div className="investigation-map-layout">
  <aside className="investigation-map-side">
   <div className="panel-title"><Globe size={18}/><h3>Investigations</h3><span className="tag">{cases.length}</span></div>
   <div className="globe-case-list">{cases.map(record=>{
    const points=located.filter(l=>l.members.some(m=>m.caseId===record.id));const saved=pins.filter(p=>p.caseId===record.id&&validPoint(p));
    const point=points[0]||saved[0];
    const pending=progress<locations.length&&locations.some(l=>l.members.some(m=>m.caseId===record.id));
    return <div className="globe-case" key={record.id}><button className="globe-case-focus" disabled={!point} onClick={()=>point&&fly(point)}><MapPin size={15}/><span><b>{record.title}</b><small>{points.length+saved.length?`${points.length+saved.length} locations`:pending?'Locating…':'No mapped location'}</small></span></button><button aria-label={`Open ${record.title}`} title="Open investigation" onClick={()=>onOpenCase(record.id)}><FolderOpen size={15}/></button></div>;
   })}{!cases.length&&<p className="muted">No investigations yet.</p>}</div>
   <form className="globe-location-form" onSubmit={e=>{e.preventDefault();if(query.trim())void locate(query.trim());}}><input aria-label="Address or coordinates" placeholder="Address, place or lat, lng" value={query} onChange={e=>{lookupVersion.current++;setFinding(false);setDraft(null);preview.current?.remove();setQuery(e.target.value);}}/><button className="map-action" disabled={!query.trim()||finding}><MapPin size={14}/>{finding?'Locating…':'Pinpoint location'}</button></form>
   {lookupError&&<p className="globe-lookup-error" role="alert">{lookupError}</p>}
   <select aria-label="Investigation for new pins" value={caseId} onChange={e=>setCaseId(e.target.value)}><option value="">Unlinked location</option>{cases.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select>
   {draft&&<button className="map-action" onClick={()=>{onAdd({...draft,caseId:caseId||undefined});setDraft(null);preview.current?.remove();}}>Save location</button>}
   {selected&&<div className="selection globe-selection"><b>{selected.name}</b>{selected.note&&<p>{selected.note}</p>}{selected.caseId&&<button onClick={()=>onOpenCase(selected.caseId!)}><FolderOpen size={14}/> Open investigation</button>}<button onClick={()=>{onRemove(selected.id);setSelected(null);popup.current?.remove();}}><Trash2 size={14}/> Remove location</button></div>}
  </aside>
  <div className="investigation-globe-panel map-wrap">
   <div ref={container} className="investigation-globe-canvas" aria-label="Rotating 3D investigation globe"/>
   <div className="globe-heading"><span className="eyebrow">INVESTIGATION GLOBE</span><span>{mappedCases.size} / {cases.length} investigations mapped</span></div>
   <div className="globe-toolbar"><button aria-label={spinning?'Pause globe rotation':'Start globe rotation'} title={spinning?'Pause rotation':'Spin globe'} aria-pressed={spinning} onClick={()=>{if(!spinning&&map.current&&map.current.getZoom()>=5)map.current.flyTo({zoom:globeZoom(container.current),duration:800});setSpinning(!spinning);}}>{spinning?<Pause size={15}/>:<Play size={15}/>}</button><button aria-label="Show whole globe" title="Show whole globe" onClick={()=>{setSpinning(false);popup.current?.remove();map.current?.flyTo({center:[10,20],zoom:globeZoom(container.current),bearing:0,pitch:0,duration:900});}}><RotateCcw size={15}/></button><button title="Open Google Maps" aria-label="Open Google Maps" onClick={()=>{const center=map.current?.getCenter();if(center)openExternal(`https://www.google.com/maps/search/?api=1&query=${center.lat},${center.lng}`);}}><ExternalLink size={15}/></button></div>
   <div className="globe-footer" role="status"><span>{progress<locations.length?`Locating addresses ${progress} / ${locations.length}`:`${located.length} addresses · ${pins.filter(validPoint).length} saved pins`}</span><span>Drag to rotate · Scroll to zoom</span></div>
   {error&&<div className="globe-error" role="alert">{error}</div>}
  </div>
  {failed.length>0&&<details className="globe-unresolved"><summary>{failed.length} addresses could not be located</summary>{failed.map(address=><p key={address}>{address}</p>)}<button className="map-action" onClick={()=>setRetry(n=>n+1)}>Retry lookup</button></details>}
 </div>;
}
