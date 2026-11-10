import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('cancellation stays booked across refresh until office confirmation',async()=>{
 const nodes=new Map();const get=s=>{if(!nodes.has(s))nodes.set(s,{value:'',textContent:'',innerHTML:'',classList:{add(){},remove(){},toggle(){}},addEventListener(){}});return nodes.get(s)};
 const state={drivers:[{id:'driver-1',taxiNumber:'25',name:'Test Driver',status:'busy',jobStatus:'cancel_requested',jobId:'cancelled-1'}],jobs:[{id:'cancelled-1',driverId:'driver-1',taxiNumber:'25',driverName:'Test Driver',pickup:'Gate A',destination:'Station',status:'cancelled'}]};
 const context=vm.createContext({document:{querySelector:get,querySelectorAll:()=>[]},window:{addEventListener(){}},location:{protocol:'https:'},localStorage:{setItem(){}},fetch:async()=>({ok:true,json:async()=>state}),setInterval(){},setTimeout(){},Intl,Date,EventSource:class{addEventListener(){}}});
 vm.runInContext(readFileSync(new URL('../public/rankflow/operations.js',import.meta.url),'utf8'),context);
 await vm.runInContext('sync()',context);
 assert.doesNotMatch(get('#taxi-queue').innerHTML,/Assign job/);
 vm.runInContext("activeFilter='busy';render()",context);
 const html=get('#taxi-queue').innerHTML;
 assert.match(html,/job-cancelled/);assert.match(html,/>Cancelled<\/button>/);assert.match(html,/data-cancel-driver/);assert.doesNotMatch(html,/data-assign-driver/);
 assert.equal(get('#busy-count').textContent,1);
 await vm.runInContext('sync()',context);assert.equal(get('#taxi-queue').innerHTML,html);
 Object.assign(state.drivers[0],{status:'available',jobStatus:'cancelled',jobId:null});
 await vm.runInContext('sync()',context);
 assert.doesNotMatch(get('#taxi-queue').innerHTML,/>Cancelled/);assert.equal(get('#busy-count').textContent,0);
 vm.runInContext("activeFilter='ready';render()",context);assert.match(get('#taxi-queue').innerHTML,/Assign job/);
});
