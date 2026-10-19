import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichmentQueue,reconcileEnrichedOffers,enrichmentSummary} from '../lib/enrichment.ts';
import {enrichmentKey,type EnrichmentRecord} from '../lib/product-enrichment.ts';
import type {CatalogListing} from '../lib/proshoper.ts';
const now=new Date('2026-10-19T15:00:00Z');
const row:CatalogListing={id:'local-yogurt',name:'Йогурт Актибио натуральный 130г',price:49.99,packGrams:130,packText:'130г',priceUnit:'pack',storeId:'5ka',sourceId:'source',sourceUrl:'https://proshoper.ru/actions/pyaterochka/kogalym/#id_product_1',localEvidence:'Когалым',evidence:'Карточка йогурта 49.99',availability:'listed',observedAt:'2026-10-19T14:00:00Z',lastSeenAt:'2026-10-19T14:00:00Z'};
const record:EnrichmentRecord={key:enrichmentKey(row),listingName:row.name,status:'matched',attempts:1,checkedAt:now.toISOString(),retryAt:'2026-11-19T00:00:00Z',reason:'Точное совпадение',candidate:{productName:row.name,brand:'Актибио',packGrams:130,macros:{kcal:60,protein:5,fat:2,carbs:5.5},sourceUrl:'https://magnit.ru/product/yogurt',observedAt:now.toISOString(),estimated:false}};
test('queue deduplicates across stores and caches both matches and misses',()=>{
  assert.equal(enrichmentQueue([row,{...row,id:'second',storeId:'magnit'}],[],[],now).length,1);
  assert.equal(enrichmentQueue([row],[record],[],now).length,0);
  assert.equal(enrichmentQueue([row],[{...record,status:'not-found',candidate:undefined}],[],now).length,0);
  assert.equal(enrichmentQueue([row],[{...record,retryAt:'2026-10-18T00:00:00Z'}],[],now).length,1);
});
test('an enriched price remains local and withdrawn or renamed local cards cannot reuse it',()=>{
  const offers=reconcileEnrichedOffers([], [row],[record],now);assert.equal(offers.length,1);assert.equal(offers[0].price,49.99);assert.equal(offers[0].sourceUrl,row.sourceUrl);
  assert.equal(reconcileEnrichedOffers(offers,[{...row,availability:'unknown'}],[record],now)[0].status,'pending');
  assert.equal(reconcileEnrichedOffers(offers,[{...row,name:'Йогурт Актибио клубника130г'}],[record],now)[0].status,'pending');
  assert.equal(reconcileEnrichedOffers([{...offers[0],verification:'user'}],[{...row,availability:'unknown'}],[record],now)[0].status,'confirmed');
});
test('summary explains coverage instead of treating all listings as edible',()=>{
  const offers=reconcileEnrichedOffers([], [row],[record],now);
  const s=enrichmentSummary([row,{...row,id:'soap',name:'Мыло туалетное90г'}],[record],offers,now);assert.equal(s.listings,2);assert.equal(s.withExternalNutrition,1);assert.equal(s.menuReady,1);assert.equal(s.unclassified,1);
});
test('new products are checked before retrying an already failed source',()=>{
  const untried={...row,id:'new',name:'Йогурт Бренд натуральный 130г'};
  const failed={...record,status:'error' as const,candidate:undefined,retryAt:'2026-10-18T00:00:00Z',attempts:2};
  assert.equal(enrichmentQueue([row,untried],[failed],[],now)[0].id,'new');
});
test('reading stored automatic prices also retires a legacy seasoning classification',()=>{
  const seasoning={...row,name:'Смесь на бумаге для нежного филе куриной грудки Maggi На Второе 30.6г',packGrams:30.6};
  const falsePrice={id:'old',foodId:'chicken',name:seasoning.name,storeId:row.storeId,price:75.99,packGrams:30.6,macros:{kcal:113,protein:23.6,fat:1.9,carbs:0},observedAt:row.observedAt,validUntil:'2026-10-20T14:00:00Z',sourceUrl:row.sourceUrl,evidence:row.evidence,localConfirmed:true,nutritionEstimated:true,status:'confirmed' as const,demo:false,verification:'catalog' as const};
  assert.equal(reconcileEnrichedOffers([falsePrice],[seasoning],[],now)[0].status,'pending');
  assert.equal(reconcileEnrichedOffers([{...falsePrice,verification:'user'}],[seasoning],[],now)[0].status,'confirmed');
});
