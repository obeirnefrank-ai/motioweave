import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../public/rankflow/driver.js',import.meta.url),'utf8');
function mock(){
 const nodes=new Map();const get=s=>{if(!nodes.has(s))nodes.set(s,{hidden:false,disabled:false,textContent:'',value:'',dataset:{},handlers:{},classList:{values:new Set(),toggle(k,v){v?this.values.add(k):this.values.delete(k)},add(){},remove(){}},addEventListener(k,f){this.handlers[k]=f}});return nodes.get(s)};
 const ctx=vm.createContext({document:{querySelector:get},location:{search:'?sampleJob=1'},localStorage:{getItem:()=>null,setItem(){}},window:{addEventListener(){}},URLSearchParams,Intl,Date,crypto:{randomUUID:()=> 'test-id'},setInterval(){},setTimeout(){},EventSource:class{addEventListener(){}},fetch(){throw Error('Mock must not write to server')}});
 vm.runInContext(source,ctx);return {get,ctx};
}
test('mock accepts, picks up, completes and clears details on break',async()=>{
 const {get,ctx}=mock();assert.equal(get('#status-text').textContent,'On a job');assert.equal(get('#availability-button').hidden,true);assert.match(get('#pickup-time').textContent,/^\d\d:\d\d$/);
 await get('#availability-button').handlers.click();assert.equal(vm.runInContext('activeJob',ctx),true);
 await get('#dropoff-button').handlers.click();assert.ok(get('#dropoff-button').classList.values.has('accepted-action'));assert.match(get('#dropoff-button').innerHTML,/Passenger picked up/);assert.equal(get('#availability-button').hidden,true);
 await get('#dropoff-button').handlers.click();assert.equal(get('#availability-button').hidden,true);
 await get('#dropoff-button').handlers.click();assert.equal(get('#availability-button').hidden,false);
 await get('#availability-button').handlers.click();assert.equal(get('#status-text').textContent,'On break');assert.equal(get('#job-details').hidden,true);
 for(const id of ['#pickup-point','#destination-point','#pickup-time','#contact-name'])assert.equal(get(id).textContent,'');
 assert.match(get('#profile-button').textContent,/Taxi 75/);
});
