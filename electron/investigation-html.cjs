'use strict';
const {clean,prepare,defaults}=require('./investigation.cjs');
const {uniquePhoneFields,isFrenchPhoneContext}=require('./phone-identity.cjs');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const populated=value=>value!=null&&(typeof value==='object'?Object.values(value).some(populated):String(value).trim()!=='');
const label=key=>key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ');
function field(key,value){
 if(!populated(value))return '';
 if(typeof value==='object')return Object.entries(value).map(([k,v])=>field(Array.isArray(value)?`${key} ${Number(k)+1}`:`${key} / ${label(k)}`,v)).join('');
 return `<div class="field"><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`;
}
function section(title,content){return content?`<section><h2>${escape(title)}</h2><dl>${content}</dl></section>`:''}
function safeUrl(value){
 if(typeof value!=='string')return '';
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:''}catch{return ''}
}
function googleValue(key,value,depth=0){
 if(depth>6||!populated(value))return '';
 const url=safeUrl(value);
 if(url)return `<div class="field"><dt>${escape(key)}</dt><dd><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(key)} &#8599;</a></dd></div>`;
 if(typeof value==='string'&&/^(?:https?:|javascript:|data:)/i.test(value))return '';
 if(typeof value==='object')return Object.entries(value).filter(([k])=>!/(?:output|raw|token|secret|password|cookie)/i.test(k)).map(([k,v])=>googleValue(`${key} / ${label(k)}`,v,depth+1)).join('');
 return field(key,typeof value==='boolean'?(value?'Yes':'No'):value);
}
function googleProfile(person){
 const profiles=(person.evidence||[]).filter(e=>/^ghunt$/i.test(e.source||'')).map(e=>e.fields||{});
 const avatar=profiles.map(f=>safeUrl(f.avatar_url)).find(Boolean)||'';
 const sections=profiles.map(f=>{
  const calendar=f.public_calendar;
  const calendarUrl=safeUrl(f.calendar_url)||(calendar&&typeof calendar==='object'&&(calendar.public===true||calendar.is_public===true)&&typeof (calendar.id||calendar.calendar_id||f.email)==='string'?'https://calendar.google.com/calendar/embed?src='+encodeURIComponent(calendar.id||calendar.calendar_id||f.email):'');
  const content=googleValue('Email',f.email)+googleValue('Google Maps reviews',f.maps_url)+googleValue('Google Calendar',calendarUrl)+googleValue('Google profile',f.profile_url)+googleValue('Reviews',f.review_status)+googleValue('Review count',f.review_count);
  const extra=Object.entries(f).filter(([k])=>!['name','email','avatar_url','maps_url','calendar_url','profile_url','review_status','review_count'].includes(k)&&!/(?:output|raw|token|secret|password|cookie)/i.test(k)).map(([k,v])=>googleValue(label(k),v)).join('');
  return content||extra?`<div class="google-profile"><dl>${content}${extra}</dl></div>`:'';
 }).join('');
 return {avatar,html:sections?`<details class="subpanel google"><summary>Google &#183; GHunt</summary>${sections}</details>`:''};
}
function htmlReport(record,excluded,settings={}){
 const exclusions=[...(excluded||defaults),...(settings.hiddenFields||[])];
 const safe=clean(record,exclusions);
 const people=(safe.people||[]).map((original,index)=>{
  const detail=clean(prepare({records:(original.evidence||[]).map(e=>e.fields||{}),categories:Object.fromEntries((original.customCategories||[]).map(c=>[c.label,c.value]))},exclusions).patch,exclusions);
  const p={...detail,...Object.fromEntries(Object.entries(original).filter(([,v])=>populated(v)))};
  Object.assign(p,uniquePhoneFields(p.phone||'',p.altPhone||'',isFrenchPhoneContext(original)));
  const rows=keys=>keys.map(([k,title])=>field(title,p[k])).join('');
  const overview=rows([['name','Full name'],['lastName','Last name'],['firstName','First name'],['age','Age'],['gender','Gender'],['address','Home address'],['email','Emails'],['phone','Phone number'],['altPhone','Alt. phone'],['username','Username'],['dateOfBirth','Date of birth'],['taxCode','Codice Fis.'],['postalCode','Postal code'],['shipping','Shipping address']]);
  const categories=(p.customCategories||[]).filter(c=>String(c.label||'').trim()&&Object.keys(clean({[c.label]:c.value},exclusions)).length);
  const homeAddresses=[p.address,...(p.evidence||[]).map(e=>clean(prepare(e.fields||{},exclusions).patch,exclusions).address),...categories.filter(c=>/^(home[ _]address|address|adresse)$/i.test(c.label)).map(c=>c.value)].filter(v=>typeof v==='string'&&v.trim());
  const unique=[...new Map(homeAddresses.map(a=>[a.trim().toLowerCase(),a.trim()])).values()];
  const maps=unique.map(address=>{const query=encodeURIComponent(address);return `<div class="map-card"><p>${escape(address)}</p><div class="map-actions"><button type="button" data-map="${escape('https://maps.google.com/maps?q='+query+'&output=embed')}" aria-expanded="false">Show Google Map</button><a href="https://www.google.com/maps/search/?api=1&amp;query=${escape(query)}" target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a></div><div class="map-frame" hidden></div></div>`}).join('');
  const google=googleProfile(p);
  return `<details class="person"><summary><span class="avatar"><span>${String(index+1).padStart(2,'0')}</span>${google.avatar?`<img src="${escape(google.avatar)}" alt="Google profile photo" referrerpolicy="no-referrer">`:''}</span><span class="person-heading"><strong>${escape(p.name||'Unnamed person')}</strong><span class="muted preview">${escape([p.email,p.age?`${p.age} years old`:'',p.username].filter(Boolean).join(' · '))}</span></span><span class="chevron" aria-hidden="true">⌄</span></summary><div class="person-body">${section('Person details',overview)}${categories.length?`<details class="subpanel"><summary>Additional details <span class="muted">${categories.length}</span></summary><dl>${categories.map(c=>field(c.label,c.value)).join('')}</dl></details>`:''}${section('Person notes',field('Notes',p.notes))}${maps?`<section><h2>Home addresses · Google Maps</h2><p class="muted map-note">Maps require internet. Showing a map sends its address to Google.</p>${maps}</section>`:''}${google.html}</div></details>`;
 }).join('');
 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="referrer" content="no-referrer"><title>${escape(safe.title||'Investigation')} · H3X</title>
<style>
:root{font-family:Inter,'Segoe UI',sans-serif;color:#efefef;background:#060606;color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 85% 0,#1b1b1b,transparent 40%);min-height:100vh}main{max-width:1040px;margin:auto;padding:48px 24px 72px}.brand{display:flex;align-items:center;gap:12px;margin-bottom:46px;font-size:12px;letter-spacing:.18em}.logo{font:600 20px monospace;border:1px solid #555;border-radius:9px;padding:9px;letter-spacing:-2px}.eyebrow,h2{font:600 10px monospace;letter-spacing:.16em;text-transform:uppercase;color:#949494}h1{font-size:clamp(25px,5vw,38px);letter-spacing:-.04em;margin:12px 0;overflow-wrap:anywhere}.muted{color:#999;font-size:12px}.toolbar,.map-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.toolbar{margin:24px 0}.count{margin-right:auto}button,a{font:inherit}button{border:1px solid #333;border-radius:8px;background:#171717;color:#eee;padding:10px 14px;cursor:pointer;font-size:12px}button:hover{background:#252525}button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid #ddd;outline-offset:4px}a{color:#ccc;font-size:12px;overflow-wrap:anywhere}.person,.overview{border:1px solid #292929;border-radius:13px;background:#0c0c0c;margin:14px 0;overflow:hidden}summary{cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}.person>summary{padding:20px;display:flex;align-items:center;gap:16px}.avatar{display:grid;place-items:center;flex-shrink:0;width:40px;height:40px;border:1px solid #333;border-radius:10px;color:#aaa;font:12px monospace}.person-heading{min-width:0;flex:1}.person-heading strong{display:block;font-size:15px;overflow-wrap:anywhere}.preview{display:block;margin-top:6px;line-height:1.6;overflow-wrap:anywhere}.chevron{color:#999;transition:transform .15s}.person[open]>summary{border-bottom:1px solid #272727}.person[open]>summary .chevron{transform:rotate(180deg)}.person-body{padding:4px 24px 24px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 32px}section{min-width:0;margin-top:25px}h2{margin:0 0 14px}dl{margin:0}.field{display:grid;grid-template-columns:minmax(90px,30%) minmax(0,1fr);gap:14px;padding:10px 0;border-bottom:1px solid #202020;font-size:13px;line-height:1.65}.field:last-child{border-bottom:0}dt{color:#969696}dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.nested{border:1px solid #282828;border-radius:8px;margin:10px 0;padding:12px;min-width:0}.nested>summary{font-size:13px;overflow-wrap:anywhere}.nested>summary:before{content:'＋';color:#999;margin-right:9px}.nested[open]>summary:before{content:'−'}.nested>.field{margin-top:12px}.map-card{border:1px solid #292929;border-radius:10px;padding:16px;margin-top:12px}.map-card p{font-size:13px;overflow-wrap:anywhere;margin:0 0 14px}.map-frame{margin-top:16px}.map-frame iframe{display:block;border:0;width:100%;height:320px;border-radius:8px;background:#181818}.map-note{line-height:1.7}.overview{padding:22px}.overview section{margin-top:0}.empty{padding:28px;color:#999;border:1px dashed #333;border-radius:12px}footer{color:#666;font-size:11px;margin-top:30px;letter-spacing:.12em}@media(max-width:600px){main{padding:24px 14px 40px}.brand{margin-bottom:30px}.person>summary{padding:16px 12px;gap:12px}.person-body{padding:0 16px 20px}.grid{grid-template-columns:1fr;gap:0}.field{grid-template-columns:1fr;gap:3px}.map-card{padding:12px}.map-frame iframe{height:260px}.toolbar button{min-height:42px}.overview{padding:16px}}@media print{body{background:white;color:black}button,.map-actions,.map-note,iframe{display:none}main{max-width:none;padding:0}.person,.overview{background:white;border-color:#bbb;break-inside:avoid}dt,.muted,h2{color:#555}}
.avatar{position:relative;overflow:hidden}.avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.google-profile+.google-profile{margin-top:20px;border-top:1px solid #333;padding-top:12px}.subpanel{margin-top:24px;border:1px solid #292929;border-radius:10px;padding:0 16px}.subpanel>summary{padding:16px 0;display:flex;align-items:center;gap:12px;font-size:13px;font-weight:600}.subpanel>summary:after{content:"+";margin-left:auto;color:#999}.subpanel[open]>summary:after{content:"−"}.subpanel[open]>summary{border-bottom:1px solid #292929;margin-bottom:8px}.subpanel>dl,.subpanel>.google-profile{padding-bottom:12px}.person-body>section:first-child h2{display:none}.person-body>section:first-child{margin-top:14px}.person-body>.subpanel{margin-top:20px}.person-body .field{grid-template-columns:150px minmax(0,1fr)}@media(max-width:600px){.person-body .field{grid-template-columns:1fr}.subpanel{padding:0 12px}}
</style></head><body><main><div class="brand"><span class="logo">H3X</span><span>INVESTIGATION FILE</span></div><div class="eyebrow">INVESTIGATIONS</div><h1>${escape(safe.title||'Investigation')}</h1>${safe.summary||safe.notes?`<div class="overview">${section('Case overview',field('Summary',safe.summary)+field('Notes',safe.notes))}</div>`:''}<div class="toolbar"><span class="count muted">${(safe.people||[]).length} ${(safe.people||[]).length===1?'person':'people'}</span><button type="button" id="expand">Expand all</button><button type="button" id="collapse">Collapse all</button></div>${people||'<p class="empty">No people saved in this investigation.</p>'}<footer>H3X SEARCHER</footer></main>
<script>
document.addEventListener('error',event=>{if(event.target.matches&&event.target.matches('.avatar img'))event.target.remove()},true);
document.getElementById('expand').addEventListener('click',()=>document.querySelectorAll('details.person').forEach(el=>el.open=true));
document.getElementById('collapse').addEventListener('click',()=>document.querySelectorAll('details').forEach(el=>el.open=false));
document.addEventListener('click',event=>{const button=event.target.closest('button[data-map]');if(!button)return;const container=button.parentElement.nextElementSibling;const show=container.hidden;container.hidden=!show;button.setAttribute('aria-expanded',String(show));button.textContent=show?'Hide Google Map':'Show Google Map';if(show&&!container.firstChild){const frame=document.createElement('iframe');frame.title='Home address on Google Maps';frame.referrerPolicy='no-referrer';frame.src=button.dataset.map;frame.allowFullscreen=true;container.appendChild(frame)}});
</script></body></html>`;
}
module.exports={htmlReport};
