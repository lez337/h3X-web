'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {htmlReport}=require('./investigation-html.cjs');
test('exports people and categories without saved evidence or raw provider data',()=>{
 const html=htmlReport({title:'Example <case>',summary:'Summary',notes:'Case notes',people:[{name:'Alex Example',email:'alex@example.org',notes:'Person notes',customCategories:[{label:'Occupation',value:'Designer'}],evidence:[{source:'Example provider',query:'alex',fields:{profile:{city:'Paris',interests:['Art','Music']},payload:'</script><script>alert(1)</script>'}}]},{name:'Second Person'}]});
 assert.equal((html.match(/class="person"/g)||[]).length,2);
 for(const text of ['Example &lt;case&gt;','Alex Example','Second Person','Person notes','Case notes','Designer'])assert.ok(html.includes(text),text);
 for(const text of ['Saved evidence','Example provider','Paris','Music','payload','alert(1)'])assert.ok(!html.includes(text),text);
 assert.ok(!html.includes('<script>alert(1)'));
 assert.ok(html.includes('name="viewport"'));
});
test('home maps are conditional, deduplicated and only loaded by clicking',()=>{
 const html=htmlReport({people:[{name:'Example',address:'1 Example Street',shipping:'2 Delivery Road',evidence:[{fields:{home_address:'1 Example Street'}},{fields:{home_address:'3 Example Lane'}}]}]});
 assert.equal((html.match(/data-map=/g)||[]).length,2);
 assert.ok(html.includes('query=1%20Example%20Street'));
 assert.ok(!html.includes('query=2%20Delivery%20Road'));
 assert.ok(!html.includes('<iframe'));
 assert.ok(!htmlReport({people:[{shipping:'Delivery only',evidence:[{fields:{city:'Paris'}}]}]}).includes('data-map='));
});
test('applies exclusions to summaries, evidence, nested fields, custom categories and maps',()=>{
 const html=htmlReport({notes:'private notes',people:[{name:'Example',address:'Secret home',email:'hidden@example.org',customCategories:[{label:'password',value:'private password'}],evidence:[{fields:{nested:{token:'private token',email:'hidden@example.org'},home_address:'Secret home',phone:'0612345678',country:'FR'}}]}]},undefined,{hiddenFields:['email','address','home_address','notes']});
 for(const value of ['Secret home','hidden@example.org','private notes','private password','private token','data-map='])assert.ok(!html.includes(value),value);
 assert.ok(html.includes('+33612345678'));
});
test('handles an empty investigation',()=>{
 assert.ok(htmlReport({title:'Empty'}).includes('No people saved'));
});
test('person details follow the requested order without nested field dropdowns',()=>{
 const html=htmlReport({people:[{name:'Example Alex',lastName:'Example',firstName:'Alex',age:'30',gender:'Female',address:'Home address',email:'alex@example.org',phone:'+12025550142',customCategories:[{label:'Interests',value:'Art'}]}]});
 const labels=['Full name','Last name','First name','Age','Gender','Home address','Emails','Phone number'];
 let previous=-1;for(const label of labels){const index=html.indexOf('<dt>'+label+'</dt>');assert.ok(index>previous,label);previous=index}
 assert.ok(!html.includes('<details class="nested">'));assert.ok(html.includes('<details class="subpanel">'));
});

test('uses GHunt photos and exports curated Google links and details without evidence metadata',()=>{
 const html=htmlReport({people:[{name:'Alex',evidence:[{source:'GHunt',query:'never-export-query',fields:{email:'alex@example.org',avatar_url:'https://lh3.googleusercontent.com/example',maps_url:'https://www.google.com/maps/contrib/123/reviews',review_count:4,review_status:'Reviews found',public_calendar:{public:true,url:'https://calendar.google.com/calendar/embed?src=alex'},play_games:{profile_url:'https://play.google.com/games/profile/123',display_name:'Alex Gamer'},google_services:['Maps','Calendar'],output:'never-export-raw-output',reviews:[{text:'An example review',url:'https://www.google.com/maps/review/123'}]}}]}]});
 for(const text of ['<img src="https://lh3.googleusercontent.com/example"','Google Maps reviews','href="https://www.google.com/maps/contrib/123/reviews"','href="https://calendar.google.com/calendar/embed?src=alex"','href="https://play.google.com/games/profile/123"','Alex Gamer','An example review','Reviews found'])assert.ok(html.includes(text),text);
 for(const text of ['never-export-query','never-export-raw-output','Saved evidence'])assert.ok(!html.includes(text),text);
});
test('filters GHunt fields and rejects unsafe profile photos and links',()=>{
 const person={name:'Alex',evidence:[{source:'GHunt',fields:{avatar_url:'javascript:alert(1)',maps_url:'javascript:alert(2)',calendar_url:'https://example.org/private-calendar',public_calendar:{public:true,id:'alex@example.org'},output:'raw-data'}}]};
 const html=htmlReport({people:[person]},undefined,{hiddenFields:['calendar_url','public_calendar']});
 for(const text of ['<img','javascript:','private-calendar','alex@example.org','raw-data'])assert.ok(!html.includes(text),text);
 const hidden=htmlReport({people:[{evidence:[{source:'GHunt',fields:{avatar_url:'https://example.org/photo'}}]}]},undefined,{hiddenFields:['avatar_url']});
 assert.ok(!hidden.includes('<img'));
});
