import type {PeopleItem} from './peopleModel';

function safeUrl(value:unknown){
 if(typeof value!=='string')return;
 try{const url=new URL(value);if(url.protocol==='https:'&&!url.username&&!url.password)return url.href}catch{}
}
const label=(key:string)=>key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ');
function links(value:unknown,title:string,depth=0):{url:string;title:string}[]{
 if(depth>6||value==null)return [];
 const url=safeUrl(value);if(url)return [{url,title}];
 if(typeof value!=='object')return [];
 return Object.entries(value).flatMap(([key,child])=>links(child,/^\d+$/.test(key)||/^(url|link|href|htmlLink|calendar_url|profile_url|html_url)$/i.test(key)?title:title+' / '+label(key),depth+1));
}
function facts(value:unknown,prefix='',depth=0):{label:string;value:string}[]{
 if(value==null||depth>6||safeUrl(value))return [];
 if(typeof value==='object')return Object.entries(value).flatMap(([key,child])=>/output|raw|token|secret|password|cookie/i.test(key)?[]:facts(child,[prefix,label(key)].filter(Boolean).join(' / '),depth+1));
 return [{label:prefix,value:typeof value==='boolean'?(value?'Yes':'No'):String(value)}];
}
export default function PeopleGoogle({items,onOpen}:{items:PeopleItem[];onOpen:(url:string)=>void}){
 return <>{items.filter(item=>item.profileType==='google'||/^ghunt$/i.test(item.source)).map(item=>{
  const f=item.fields||{},targets=[...links(f.maps_url,'Google Maps reviews'),...links(f.calendar_url,'Google Calendar'),...links(f.public_calendar,'Google Calendar'),...links(f.play_games,'Google Play Games'),...links(f.profile_url,'Google profile')];
  const calendar=f.public_calendar;
  if(!targets.some(t=>t.title.startsWith('Google Calendar'))&&calendar&&typeof calendar==='object'){
   const c=calendar as Record<string,unknown>;
   if(c.public===true||c.is_public===true){const id=c.id||c.calendar_id||f.email;if(typeof id==='string')targets.push({url:'https://calendar.google.com/calendar/embed?src='+encodeURIComponent(id),title:'Google Calendar'})}
  }
  const unique=[...new Map(targets.map(link=>[link.url,link])).values()];
  const extra=[...facts(f.public_calendar,'Calendar'),...facts(f.play_games,'Play Games'),...facts(f.maps_statistics,'Maps')].filter(f=>!/^Maps \/ (reviews|review count|reviews count|reviewCount|reviewsCount)( \/ count)?$/i.test(f.label));
  return <section className="people-section people-google" id={'result-'+encodeURIComponent(item.id)} tabIndex={-1} key={item.id}>
   <h5>Google · GHunt{items.filter(i=>i.profileType==='google').length>1&&typeof f.email==='string'?' · '+f.email:''}</h5>
   <p className="people-google-status">Reviews: {typeof f.review_status==='string'?f.review_status:'Unavailable'}{f.review_status!=='Unavailable'&&typeof f.review_count==='number'?' ('+f.review_count+')':''}</p>
   {!!unique.length&&<div className="people-google-links">{unique.map(link=><a href={link.url} key={link.url} onClick={event=>{event.preventDefault();onOpen(link.url)}}>{link.title}</a>)}</div>}
   {!!extra.length&&<dl className="people-details">{extra.map((fact,i)=><div className="people-detail" key={i}><dt>{fact.label}</dt><dd><span>{fact.value}</span></dd></div>)}</dl>}
   {Array.isArray(f.reviews)&&f.reviews.length>0&&<details className="people-google-reviews"><summary>Returned reviews ({f.reviews.length})</summary>{f.reviews.map((review,i)=><div key={i}>{links(review,'View review').map(link=><a href={link.url} key={link.url} onClick={event=>{event.preventDefault();onOpen(link.url)}}>{link.title}</a>)}{facts(review).map((fact,j)=><p key={j}>{fact.label&&<small>{fact.label}: </small>}{fact.value}</p>)}</div>)}</details>}
  </section>;
 })}</>;
}
