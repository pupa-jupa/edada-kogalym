import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCatalogRefresh,mergeListings} from '../lib/catalog-sync.ts';
import type {CatalogListing} from '../lib/proshoper.ts';
const now=new Date('2026-10-19T15:00:00Z');
const row:CatalogListing={id:'one',name:'Рис 800г',price:49.99,packGrams:800,priceUnit:'pack',storeId:'5ka',sourceId:'source',sourceUrl:'https://proshoper.ru/kogalym/actions/5ka/#id_product_1',localEvidence:'Когалым',evidence:'49.99',availability:'listed',observedAt:now.toISOString(),lastSeenAt:now.toISOString()};
test('known price refresh updates saved IDs; new IDs are admitted only by discovery',()=>{
 const other={...row,id:'two',sourceUrl:row.sourceUrl+'2'};
 const incoming=[{...row,price:59.99},other];
 assert.deepEqual(selectCatalogRefresh([row],incoming,'source','known').listings,incoming.slice(0,1));
 assert.equal(selectCatalogRefresh([row],incoming,'source','known').discovered,0);
 assert.equal(selectCatalogRefresh([row],incoming,'source','discover').discovered,1);
 assert.equal(selectCatalogRefresh([],incoming,'source','known').listings.length,0);
});
test('category changes track names, conditions, validity and availability without markup noise',()=>{
 const same=mergeListings([row],[{...row,evidence:'different markup'}],'source',now)[0];
 assert.equal(same.changes?.length,0);
 const renamed=mergeListings([row],[{...row,name:'Рис новый 800г',validUntil:'2026-10-22T00:00:00Z'}],'source',now)[0];
 assert.equal(renamed.changes?.length,1);
 assert.equal(renamed.lastChangedAt,now.toISOString());
 assert.equal(renamed.changes?.[0].name,row.name);
});
