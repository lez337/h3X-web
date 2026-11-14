export function download(text:string,name:string,type='text/plain;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([text],{type})),anchor=document.createElement('a');
  anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
}
export function pickFiles(accept:string,multiple=false):Promise<File[]>{return new Promise(resolve=>{
  const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;
  input.style.display='none';document.body.append(input);let settled=false;
  const finish=()=>{if(settled)return;settled=true;resolve(Array.from(input.files||[]));window.removeEventListener('focus',focused);input.remove()};
  const focused=()=>setTimeout(finish,1000);
  input.onchange=finish;input.oncancel=finish;window.addEventListener('focus',focused,{once:true});input.click();
});}
