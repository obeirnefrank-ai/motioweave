import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

test('driver cancellation holds taxi until office confirms, with retry safety', async()=>{
 const db=new DatabaseSync(':memory:');
 const DB={prepare(sql){let args=[];return {bind(...v){args=v;return this},async all(){return {results:db.prepare(sql).all(...args)}},async first(){return db.prepare(sql).get(...args)||null},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}}},async batch(statements){return Promise.all(statements.map(s=>s.run()))}};
 let source=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8').replace(/^import .*;$/gm,'').split('export default')[0];
 const ctx=vm.createContext({Response,Request,URL,crypto,Date,console});vm.runInContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022}),ctx);
 await ctx.ensureSchema(DB);db.exec(readFileSync(new URL('../drizzle/0000_spooky_bushwacker.sql',import.meta.url),'utf8'));await DB.prepare('INSERT INTO sessions VALUES (?,?)').bind('test-session','2099-01-01').run();
 const env={DB};const call=async(path,method='GET',body)=>{const req=new Request('https://test.local'+path,{method,headers:{cookie:'rankflow_session=test-session','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const r=await ctx.api(req,env,new URL(req.url));assert.ok(r.ok,await r.clone().text());return r.json()};
 await call('/api/drivers/test','PUT',{name:'Test driver',taxiNumber:'99',status:'available'});
 const driver=(await call('/api/state')).drivers[0];
 const sent=await call('/api/jobs','POST',{driverId:'test',pickup:'Main Gate',destination:'Helipad',contactName:"Anne-Marie O’Neill",passengerCount:2,expectedDriverVersion:driver.driverVersion,requestId:crypto.randomUUID()});
 const pending=await call(`/api/jobs/${sent.job.id}/transition`,'POST',{action:'request_cancel',expectedJobVersion:1,requestId:crypto.randomUUID()});
 assert.equal(pending.driver.status,'busy');assert.equal(pending.driver.jobId,sent.job.id);assert.equal(pending.driver.availableSince,null);
 const held=await call('/api/state');assert.equal(held.drivers[0].jobStatus,'cancel_requested');assert.equal(held.drivers[0].jobId,sent.job.id);
 await assert.rejects(call('/api/drivers/test','PUT',{name:'Test driver',taxiNumber:'99',status:'available'}));
 await assert.rejects(call('/api/jobs','POST',{driverId:'test',pickup:'Other Gate',destination:'Station',passengerCount:1,expectedDriverVersion:held.drivers[0].driverVersion,requestId:crypto.randomUUID()}));
 await assert.rejects(call(`/api/jobs/${sent.job.id}/transition`,'POST',{action:'pickup',expectedJobVersion:2,requestId:crypto.randomUUID()}));
 const requestId=crypto.randomUUID();
 const confirmed=await call(`/api/jobs/${sent.job.id}/transition`,'POST',{action:'cancel',confirmation:'CANCEL',expectedJobVersion:2,requestId});
 assert.equal(confirmed.driver.status,'available');assert.equal(confirmed.driver.jobId,null);assert.ok(confirmed.driver.availableSince);
 const replay=await call(`/api/jobs/${sent.job.id}/transition`,'POST',{action:'cancel',confirmation:'CANCEL',expectedJobVersion:2,requestId});assert.deepEqual(replay,confirmed);
 const saved=await call('/api/state');assert.equal(saved.drivers[0].jobStatus,'cancelled');assert.equal(saved.jobs[0].status,'cancelled');
});
