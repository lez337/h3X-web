import JSZip from 'jszip';
import {scanner} from './shared.js';
const MB=1024*1024;
const supported=/\.(txt|log|csv|tsv|json|jsonl|ndjson)$/i;
export function decodeText(bytes:Uint8Array){
  let encoding='UTF-8',text:string;
  if(bytes[0]===255&&bytes[1]===254){encoding='UTF-16 LE';text=new TextDecoder('utf-16le',{fatal:true}).decode(bytes.subarray(2))}
  else if(bytes[0]===254&&bytes[1]===255){encoding='UTF-16 BE';text=new TextDecoder('utf-16be',{fatal:true}).decode(bytes.subarray(2))}
  else{const sample=bytes.subarray(0,4096);let even=0,odd=0;for(let i=0;i<sample.length;i++)if(sample[i]===0)(i%2?odd++:even++);
    if(sample.length>=8&&(odd>sample.length*.3||even>sample.length*.3)){encoding=odd>even?'UTF-16 LE':'UTF-16 BE';text=new TextDecoder(odd>even?'utf-16le':'utf-16be',{fatal:true}).decode(bytes)}
    else try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{encoding='Windows-1252';text=new TextDecoder('windows-1252').decode(bytes)}
  }
  if(text.includes('\0')||(text.match(/[\x01-\x08\x0b\x0e-\x1f]/g)||[]).length>Math.max(3,text.length*.01))throw Error('Binary content is not supported.');
  return {text:text.replace(/^\uFEFF/,''),encoding};
}
self.onmessage=async event=>{
  const {files,options}=event.data;const start=Date.now(),limit=Math.min(3000,Math.max(1,Number(options.limit)||1000));
  const result:any={file:files.length===1?files[0].name:`${files.length} selected files`,hits:[],count:0,truncated:false,warnings:[],filesScanned:0,filesSkipped:0,bytesScanned:0,encodings:[],durationMs:0};
  let expanded=0,entries=0;
  const warn=(file:string,message:string)=>{result.filesSkipped++;if(result.warnings.length<50)result.warnings.push({file,message})};
  const scan=(bytes:Uint8Array,name:string)=>{
    if(++entries>1000)throw Error('Archive file-count limit reached.');
    if(bytes.length>20*MB)throw Error('Text file exceeds 20 MB.');
    const {text,encoding}=decodeText(bytes),detail=scanner.scanDetailed(text,name,{...options,limit:limit-result.hits.length+1});
    result.filesScanned++;result.bytesScanned+=bytes.length;if(!result.encodings.includes(encoding))result.encodings.push(encoding);
    for(const message of detail.warnings)if(result.warnings.length<50)result.warnings.push({file:name,message});
    result.hits.push(...detail.hits.slice(0,limit-result.hits.length));result.truncated||=detail.truncated||result.hits.length>=limit;
    self.postMessage({type:'progress',data:{phase:'scanning',file:name,filesScanned:result.filesScanned,matches:result.hits.length}});
  };
  try{
    for(const file of files as File[]){
      if(result.hits.length>=limit){result.truncated=true;break}
      try{
        if(/\.zip$/i.test(file.name)){
          const archive=await JSZip.loadAsync(await file.arrayBuffer()),list=Object.values(archive.files);
          if(list.length>2000)throw Error('ZIP exceeds 2,000 entries.');
          for(const entry of list){
            if(entry.dir)continue;if(result.hits.length>=limit){result.truncated=true;break}
            if(!supported.test(entry.name)){warn(entry.name,'Unsupported ZIP entry.');continue}
            if(/(^|\/)\.\.(\/|$)|^[/\\]|^[a-z]:/i.test(entry.name)){warn(entry.name,'Invalid archive path.');continue}
            try{
              const bytes=await new Promise<Uint8Array>((resolve,reject)=>{
                const parts:Uint8Array[]=[];let size=0,failed=false;const stream=(entry as any).internalStream('uint8array');
                stream.on('data',(part:Uint8Array)=>{if(failed)return;size+=part.length;expanded+=part.length;if(size>20*MB||expanded>100*MB){failed=true;stream.pause();reject(Error('ZIP decompression limit reached.'));return}parts.push(part)});
                stream.on('error',reject);stream.on('end',()=>{const joined=new Uint8Array(size);let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.length}resolve(joined)});stream.resume();
              });scan(bytes,file.name+'/'+entry.name);
            }catch(error){warn(entry.name,(error as Error).message)}
            if(expanded>100*MB)break;
          }
        }else if(supported.test(file.name)){if(file.size>20*MB)throw Error('Text file exceeds 20 MB.');scan(new Uint8Array(await file.arrayBuffer()),file.name)}
        else warn(file.name,'Unsupported file type.');
      }catch(error){warn(file.name,(error as Error).message)}
    }
    result.count=result.hits.length;result.durationMs=Date.now()-start;self.postMessage({type:'result',data:result});
  }catch(error){self.postMessage({type:'error',message:(error as Error).message})}
};
