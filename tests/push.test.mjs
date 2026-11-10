import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8').replace(/^import .*;$/gm,'').split('export default')[0];

test('VAPID signature and provider audience are valid; expired endpoints removed',async()=>{
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const env={VAPID_PRIVATE_JWK:JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey)),VAPID_PUBLIC_KEY:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url')};
 const endpoint='https://web.push.apple.com/test';let calls=0,removed=false;
 env.DB={prepare(sql){return {bind(){return this},async all(){return {results:[{endpoint}]}},async run(){removed=sql.startsWith('DELETE');}}}};
 const ctx=vm.createContext({crypto,TextEncoder,Uint8Array,btoa,Date,URL,AbortSignal,fetch:async(url,options)=>{
  assert.equal(url,endpoint);assert.equal(options.redirect,'error');assert.equal(options.headers.TTL,'300');
  const token=options.headers.Authorization.match(/t=([^,]+)/)[1];const [header,payload,signature]=token.split('.');
  assert.equal(JSON.parse(Buffer.from(payload,'base64url')).aud,'https://web.push.apple.com');
  assert.ok(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,Buffer.from(signature,'base64url'),new TextEncoder().encode(header+'.'+payload)));
  calls++;return {ok:calls===1,status:calls===1?201:410};
 }});vm.runInContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022}),ctx);
 assert.equal((await ctx.notifyDriver(env,'driver')).sent,1);
 assert.equal((await ctx.notifyDriver(env,'driver')).status,'failed');assert.ok(removed);
 for(const url of ['http://web.push.apple.com/x','https://web.push.apple.com.evil.test/x','https://127.0.0.1/x','https://user@web.push.apple.com/x'])assert.equal(ctx.validPushEndpoint(url),false);
});
test('shared app worker installs only rankflow assets and displays push alerts',async()=>{
 const handlers={};let visible,done;
 const opened=[];const ctx=vm.createContext({URL,caches:{open:async()=>({addAll:async assets=>opened.push(...assets)}),keys:async()=>[]},fetch:async()=>({clone(){return this}}),self:{addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting(){},clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async()=>{}},registration:{showNotification:async(title,options)=>{visible={title,options}}}}});
 vm.runInContext(readFileSync(new URL('../public/rankflow/service-worker.js',import.meta.url),'utf8'),ctx);
 handlers.install({waitUntil:p=>done=p});await done;
 assert.ok(opened.length);assert.ok(opened.every(asset=>asset.startsWith('/rankflow/')));
 handlers.push({waitUntil:p=>done=p});await done;assert.match(visible.title,/New job/);assert.equal(visible.options.data.url,'/rankflow/driver.html');
});
