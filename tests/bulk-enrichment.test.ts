import test from 'node:test';
import assert from 'node:assert/strict';
import {mapWithinBudget,mergeBulkRecords,bulkCatalogSignature} from '../lib/bulk-enrichment.ts';
import {enrichmentKey,type EnrichmentRecord} from '../lib/product-enrichment.ts';
import type {CatalogListing} from '../lib/proshoper.ts';
const row={id:'one',name:'Йогурт Актибио натуральный 3.5% 130г',packGrams:130,priceUnit:'pack',price:35,sourceId:'s',sourceUrl:'https://proshoper.ru/kogalym/#one',storeId:'magnit',availability:'listed',observedAt:'2026-10-19T14:00:00Z',lastSeenAt:'2026-10-19T14:00:00Z',localEvidence:'Когалым',evidence:'35руб'} as CatalogListing;
const now=new Date('2026-10-19T14:30:00Z');
test('bulk workers are bounded, retain order and stop scheduling after deadline',async()=>{
 let active=0,maximum=0,clock=0;
 const result=await mapWithinBudget([0,1,2,3,4],2,5,async n=>{active++;maximum=Math.max(maximum,active);await Promise.resolve();clock+=3;active--;return n*2;},()=>clock);
 assert.equal(maximum,2);assert.deepEqual(result,[0,2]);
});
test('failed bulk lookup cannot replace a verified product or newer result',()=>{
 const record:EnrichmentRecord={key:enrichmentKey(row),listingName:row.name,status:'matched',reason:'Verified',attempts:1,provider:'web',checkedAt:now.toISOString(),retryAt:'2026-11-19T00:00:00Z'};
 const next=mergeBulkRecords([record],[{row,result:{status:'not-found',reason:'Not in retailer index'}}],now);
 assert.equal(next[0].status,'matched');
 const newer={...record,status:'error' as const,checkedAt:'2026-10-19T14:31:00Z'};
 assert.equal(mergeBulkRecords([newer],[{row,result:{status:'not-found',reason:'Miss'}}],now)[0].checkedAt,newer.checkedAt);
});
test('catalog signature ignores order and notices a changed package',()=>{
 assert.equal(bulkCatalogSignature([row,{...row,id:'two',name:'Крупа Бренд 400г'}]),bulkCatalogSignature([{...row,id:'two',name:'Крупа Бренд 400г'},row]));
 assert.notEqual(bulkCatalogSignature([row]),bulkCatalogSignature([{...row,packGrams:140}]));
});
test('a failed worker waits for already assigned requests and starts no more work',async()=>{
 let settled=false,assigned=0;
 await assert.rejects(mapWithinBudget([0,1,2],2,100,async n=>{assigned++;if(n===0)throw new Error('rate limit');await new Promise(r=>setTimeout(r,10));settled=true;return n;},()=>0),/rate limit/);
 assert.equal(settled,true);assert.equal(assigned,2);
});
