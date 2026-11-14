const reportPath=/^\/reports\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/?$/;
const escape=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

// Keep previews independent of report contents, sessions, and access codes.
// Chat crawlers receive metadata without needing to run JavaScript.
export async function withLinkPreview(request,response){
  const url=new URL(request.url),report=reportPath.test(url.pathname);
  if(!['GET','HEAD'].includes(request.method)||(url.pathname!=='/'&&!report)||!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const title=report?'H3X — Shared Investigation':'H3X — Investigation Workspace';
  const description=report?'Open this shared investigation in H3X. Protected investigations require an access code.':'Organize evidence, connect findings, and share investigations with H3X.';
  const canonical=escape(url.origin+url.pathname),image=escape(new URL('/icon.png?v=2',url.origin).href);
  const tags=`<title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="H3X">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${image}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="256">
  <meta property="og:image:height" content="256">
  <meta property="og:image:alt" content="H3X logo">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${image}">
  <meta name="twitter:image:alt" content="H3X logo">
  <link rel="canonical" href="${canonical}">
  ${report?'<meta name="robots" content="noindex, nofollow, noarchive">':''}`;
  const html=(await response.text()).replace(/<!-- h3x-preview:start -->[\s\S]*?<!-- h3x-preview:end -->/i,'').replace(/<title>[\s\S]*?<\/title>/i,'').replace(/<meta\s+name="description"[^>]*>/i,'').replace('</head>',tags+'\n</head>');
  const headers=new Headers(response.headers);
  for(const name of ['Content-Length','Content-Encoding','ETag','Last-Modified'])headers.delete(name);
  headers.set('Cache-Control','no-store');
  if(report)headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
  return new Response(request.method==='HEAD'?null:html,{status:response.status,headers});
}
