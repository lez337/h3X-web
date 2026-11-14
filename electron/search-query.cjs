'use strict';
const net=require('node:net');
const fields={first_name:'prenom',last_name:'nom_famille',email:'email',phone:'telephone',discord:'discord_id',steam:'steam_id',address:'adresse',name:'nom_affichage',username:'nom_utilisateur',ip:'adresse_ip',domain:'nom_utilisateur',text:'nom_affichage',roblox:'nom_utilisateur'};
const labels={first_name:'First name',last_name:'Last name',email:'Email',phone:'Phone number',discord:'Discord ID',steam:'Steam ID',address:'Street address',name:'Full name',username:'Username',ip:'IP address',domain:'Domain',text:'Text',roblox:'Roblox ID'};
function inspectQuery(value,requested='auto'){
 const original=String(value??'').trim();
 if(!original||original.length>256||/[\x00-\x1f\x7f]/.test(original))throw Error('Enter one search term (up to 256 characters).');
 if(requested!=='auto'&&!Object.hasOwn(fields,requested))throw Error('Choose a valid search type.');
 let query=original,type='',platform='';
 const prefix=query.match(/^(discord|steam|phone|tel|email|address|username|roblox)\s*:\s*(.+)$/i);
 if(prefix){type=prefix[1].toLowerCase().replace(/^tel$/,'phone');if(!(type==='steam'&&/^steam:[a-f0-9]{15,16}$/i.test(query)))query=prefix[2].trim();}
 const mention=query.match(/^<@!?(\d{14,20})>$/);
 if(mention){type='discord';query=mention[1];}
 let url;try{url=new URL(query)}catch{}
 if(url&&['https:','http:'].includes(url.protocol)&&!url.username&&!url.password){
  const host=url.hostname.toLowerCase().replace(/^www\./,''),parts=url.pathname.split('/').filter(Boolean);
  if(['discord.com','discordapp.com'].includes(host)&&parts[0]==='users'&&/^\d{14,20}$/.test(parts[1]||'')){type='discord';query=parts[1];}
  if(host==='steamcommunity.com'&&['id','profiles'].includes(parts[0])&&/^[a-z0-9_-]{2,64}$/i.test(parts[1]||'')){type='steam';query=parts[1];}
  if(host==='roblox.com'&&parts[0]==='users'&&/^\d+$/.test(parts[1]||'')){type='roblox';query=parts[1];}
 }
 if(requested!=='auto')type=requested;
 if(!type){
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query))type='email';
  else if(net.isIP(query))type='ip';
  else if(/^7656119\d{10}$/.test(query)||/^STEAM_[0-5]:[01]:\d+$/i.test(query)||/^\[U:1:\d+\]$/i.test(query)||/^steam:[a-f0-9]{15,16}$/i.test(query))type='steam';
  else if(/^\d{14,20}$/.test(query))type='discord';
  else if(/^\+?[\d\s().-]+$/.test(query)&&/^\d{7,15}$/.test(query.replace(/\D/g,'')))type='phone';
  else if(/^(?:\d+\s*\p{L}?\s*[,.-]?\s+.+|(?:rue|avenue|boulevard|chemin|route|impasse|all[eé]e|place|quai|strasse|straße|via|calle)\s+.+)$/iu.test(query)||/\b(?:street|road|lane|drive|court|strasse|straße)\b/iu.test(query)&&/\d/.test(query)&&/\s/.test(query))type='address';
  else if(/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}$/i.test(query))type='domain';
  else if(/^@?[a-z\d_][a-z\d_.-]{0,63}$/i.test(query)&&/[a-z_]/i.test(query))type='username';
  else if(/^\p{L}[\p{L}\p{M} .'-]*\s+\p{L}[\p{L}\p{M} .'-]*$/u.test(query))type='name';
  else type='text';
 }
 if(type==='phone'){
  if(!/^\+?[\d\s().-]+$/.test(query)||!/^\d{7,15}$/.test(query.replace(/\D/g,'')))throw Error('Enter a phone number with 7–15 digits.');
  query=query.replace(/[\s().-]/g,'');
 }
 if(type==='discord'&&!/^\d{14,20}$/.test(query))throw Error('Enter a Discord ID with 14–20 digits.');
 if(type==='username')query=query.replace(/^@/,'');
 if(type==='steam'){
  const legacy=query.match(/^STEAM_[0-5]:([01]):(\d+)$/i),modern=query.match(/^\[U:1:(\d+)\]$/i),hex=query.match(/^steam:([a-f0-9]{15,16})$/i);
  if(legacy)query=String(76561197960265728n+BigInt(legacy[2])*2n+BigInt(legacy[1]));
  if(modern)query=String(76561197960265728n+BigInt(modern[1]));
  if(hex)query=String(BigInt('0x'+hex[1]));
  platform='steam';
 }
 return {query,type,label:labels[type],field:fields[type],platform};
}
module.exports={inspectQuery};
