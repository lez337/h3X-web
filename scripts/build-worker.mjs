import {build} from 'esbuild';
import path from 'node:path';
await build({entryPoints:['worker/index.mjs'],bundle:true,platform:'node',format:'esm',target:'es2022',
  outfile:'dist/server/index.js',external:['node:*'],minify:true,
  plugins:[{name:'desktop-boundary',setup(build){build.onResolve({filter:/public-providers\.cjs$/},()=>({path:path.resolve('worker/desktop.cjs')}));}}],
  banner:{js:`import * as h3xNet from 'node:net';
import * as h3xCrypto from 'node:crypto';
import * as h3xUrl from 'node:url';
import * as h3xTimers from 'node:timers/promises';
const require = name => {const modules={'node:net':h3xNet,'node:crypto':h3xCrypto,'node:url':h3xUrl,'node:timers/promises':h3xTimers};if(modules[name])return modules[name];throw Error('Unsupported Worker module: '+name)};`}
});
