// Online app: never cache account responses, reports, provider results or app bundles.
// A new launch uses the same deployed frontend as the website.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
