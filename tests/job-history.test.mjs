import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

test('passenger name survives dispatch, acceptance, completion and data reload', async()=>{
 const db=new DatabaseSync(':memory:');
 const DB={prepare(sql){let args=[];return {bind(...v){args=v;return this},async all(){return {results:db.prepare(sql).all(...args)}},async first(){return db.prepare(sql).get(...args)||null},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}}},async batch(statements){return Promise.all(statements.map(s=>s.run()))}};
 let source=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8').replace(/^import .*;$/gm,'').split('export default')[0];
 const ctx=vm.createContext({Response,Request,URL,crypto,Date,console});vm.runInContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022}),ctx);
 await ctx.ensureSchema(DB);db.exec(readFileSync(new URL('../drizzle/0000_spooky_bushwacker.sql',import.meta.url),'utf8'));await DB.prepare('INSERT INTO sessions VALUES (?,?)').bind('test-session','2099-01-01').run();
 const env={DB};const call=async(path,method='GET',body)=>{const req=new Request('https://test.local'+path,{method,headers:{cookie:'rankflow_session=test-session','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const r=await ctx.api(req,env,new URL(req.url));assert.ok(r.ok,await r.clone().text());return r.json()};
 await call('/api/drivers/test','PUT',{name:'Test driver',taxiNumber:'99',status:'available'});
 const driver=(await call('/api/state')).drivers[0];
 const sent=await call('/api/jobs','POST',{driverId:'test',pickup:'Main Gate',destination:'Helipad',contactName:"Anne-Marie O’Neill",passengerCount:2,jobMessage:'Please call the passenger when you arrive.',expectedDriverVersion:driver.driverVersion,requestId:crypto.randomUUID()});
 const active=await call('/api/state');assert.equal(active.drivers[0].jobMessage,'Please call the passenger when you arrive.');assert.equal(sent.job.jobMessage,'Please call the passenger when you arrive.');
 for(const [index,action] of ['acknowledge','pickup','dropoff'].entries())await call(`/api/jobs/${sent.job.id}/transition`,'POST',{action,expectedJobVersion:index+1,requestId:crypto.randomUUID()});
 const saved=await call('/api/state');assert.equal(saved.drivers[0].jobId,null);assert.equal(saved.jobs.length,1);assert.equal(saved.jobs[0].contactName,"Anne-Marie O’Neill");assert.equal(saved.jobs[0].jobMessage,'Please call the passenger when you arrive.');assert.equal(saved.jobs[0].status,'completed');assert.ok(saved.jobs[0].acceptedAt);assert.ok(saved.jobs[0].completedAt);
 const nodes=new Map();const get=s=>{if(!nodes.has(s))nodes.set(s,{value:'',textContent:'',innerHTML:'',classList:{add(){},remove(){},toggle(){}},addEventListener(){}});return nodes.get(s)};
 const ui=vm.createContext({document:{querySelector:get,querySelectorAll:()=>[]},window:{addEventListener(){}},location:{protocol:'https:'},localStorage:{setItem(){}},fetch:async()=>({ok:true,json:async()=>saved}),setInterval(){},Intl,Date,EventSource:class{addEventListener(){}}});
 vm.runInContext(readFileSync(new URL('../public/rankflow/data.js',import.meta.url),'utf8'),ui);await vm.runInContext('sync()',ui);
 assert.match(get('#office-records').innerHTML,/Completed/);assert.match(get('#office-records').innerHTML,/Anne-Marie O’Neill/);assert.equal(get('#office-jobs').textContent,1);
 await vm.runInContext('sync()',ui);assert.equal(get('#office-jobs').textContent,1);
});
