import test from 'node:test';
import assert from 'node:assert/strict';
import {nextMaintenanceTask,catalogDiscoveryDue} from '../lib/maintenance.ts';
test('permanently failing known sources cannot starve discovery or recipe generation',()=>{
 let phase=0;const seen:string[]=[];
 for(let i=0;i<8;i++){const next=nextMaintenanceTask(phase,{known:true,catalog:true,discovery:true,recipes:true})!;seen.push(next.task);phase=next.nextPhase;}
 assert.deepEqual(seen,['known','catalog','discovery','recipes','known','catalog','discovery','recipes']);
 assert.equal(nextMaintenanceTask(0,{known:false,catalog:false,discovery:false,recipes:false}),undefined);
 assert.equal(nextMaintenanceTask(0,{known:false,catalog:false,discovery:true,recipes:false})?.task,'discovery');
});
test('catalog discovery has independent success cadence and error backoff',()=>{
 const now=new Date('2026-10-19T15:00:00Z');
 assert.equal(catalogDiscoveryDue({enabled:true},now),true);
 assert.equal(catalogDiscoveryDue({enabled:true,lastDiscovery:now.toISOString()},now),false);
 assert.equal(catalogDiscoveryDue({enabled:true,nextDiscoveryAfter:'2026-10-20T15:00:00Z'},now),false);
 assert.equal(catalogDiscoveryDue({enabled:false},now),false);
});
