import {setWorkerUrl} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// Bundle the module worker explicitly so it also resolves from packaged file:// pages.
setWorkerUrl(workerUrl);
