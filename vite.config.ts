import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ 
  plugins: [react()], 
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: {'/api':{
    target:'http://127.0.0.1:8787',changeOrigin:true,
    configure(proxy){proxy.on('proxyReq',(request,source)=>{if(source.headers.origin==='http://127.0.0.1:5173')request.setHeader('Origin','http://127.0.0.1:8787')})}
  }} },
  base: '/',
  build: {outDir:'dist/client'},
  optimizeDeps: {
    exclude: ['maplibre-gl-worker']
  }
});
