import {createHash,pbkdf2Sync} from 'node:crypto';
import {H3xAccount} from '../../worker/accounts.mjs';

export const fixtureName='FixtureOwner',fixtureKey='08123456';
const id=createHash('sha256').update(fixtureName.toLowerCase()).digest('hex'),token='b'.repeat(64),salt='00'.repeat(16);
export const fixtureCookie=`h3x_account=${id}.${token}`;
export function accountEnvironment({expired=false}={}){
  const objects=new Map();
  function context(name){
    if(objects.has(name))return objects.get(name);
    const data=new Map();let queue=Promise.resolve();
    const storage={
      async get(key){return Array.isArray(key)?new Map(key.filter(k=>data.has(k)).map(k=>[k,structuredClone(data.get(k))])):structuredClone(data.get(key))},
      async put(key,value){if(typeof key==='object')for(const [k,v] of Object.entries(key))data.set(k,structuredClone(v));else data.set(key,structuredClone(value))},
      async delete(key){for(const k of Array.isArray(key)?key:[key])data.delete(k)},
      async deleteAll(){data.clear()},async setAlarm(){},async deleteAlarm(){},async transaction(operation){return operation(storage)}
    };
    const ctx={storage,blockConcurrencyWhile(operation){const result=queue.then(operation);queue=result.catch(()=>{});return result}};
    objects.set(name,ctx);return ctx;
  }
  // Seed a real account session so API tests use the same authentication as the application.
  context(id).storage.put('account',{id,name:fixtureName,salt,keyHash:pbkdf2Sync(fixtureKey,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex'),sessions:[{hash:createHash('sha256').update(token).digest('hex'),expires:Date.now()+(expired?-1000:3600000)}]});
  return {H3X_ACCOUNTS:{context,objects,idFromName:name=>name,get:name=>({fetch:request=>new H3xAccount(context(name)).fetch(request)})},ASSETS:{fetch:()=>new Response('H3X')}};
}
