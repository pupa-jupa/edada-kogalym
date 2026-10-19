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
  const s=enrichmentSummary([row,{...row,id:'soap',name:'Мыло туалетное90г'}],[record],offers,now);assert.equal(s.listings,2);assert.equal(s.withExternalNutrition,1);assert.equal(s.menuReady,1);assert.equal(s.excluded,1);assert.equal(s.unclassified,0);
});
test('new products are checked before retrying an already failed source',()=>{
  const untried={...row,id:'new',name:'Йогурт Бренд натуральный 130г'};
  const failed={...record,status:'error' as const,candidate:undefined,retryAt:'2026-10-18T00:00:00Z',attempts:2};
  assert.equal(enrichmentQueue([row,untried],[failed],[],now)[0].id,'new');
});
test('an unfamiliar culinary type still receives an automatic nutrition search',()=>{
  const sourCream={...row,name:'Сметана Бренд 20% 180г',packGrams:180};
  const spoon={...row,id:'spoon',name:'Ложка для спагетти DP-60/5'};
  assert.equal(enrichmentQueue([sourCream,spoon],[],[],now).length,1);
  assert.equal(enrichmentQueue([sourCream,spoon],[],[],now)[0].name,sourCream.name);
});
test('reading stored automatic prices also retires a legacy seasoning classification',()=>{
  const seasoning={...row,name:'Смесь на бумаге для нежного филе куриной грудки Maggi На Второе 30.6г',packGrams:30.6};
  const falsePrice={id:'old',foodId:'chicken',name:seasoning.name,storeId:row.storeId,price:75.99,packGrams:30.6,macros:{kcal:113,protein:23.6,fat:1.9,carbs:0},observedAt:row.observedAt,validUntil:'2026-10-20T14:00:00Z',sourceUrl:row.sourceUrl,evidence:row.evidence,localConfirmed:true,nutritionEstimated:true,status:'confirmed' as const,demo:false,verification:'catalog' as const};
  assert.equal(reconcileEnrichedOffers([falsePrice],[seasoning],[],now)[0].status,'pending');
  assert.equal(reconcileEnrichedOffers([{...falsePrice,verification:'user'}],[seasoning],[],now)[0].status,'confirmed');
});

test('owner verified records never return to automated lookup after their retry deadline',()=>{
 const reviewed={...record,retryAt:'2026-10-18T00:00:00Z',candidate:{...record.candidate!,userVerified:true,reviewKind:'yogurt'}};
 assert.equal(enrichmentQueue([row],[reviewed],[],now).length,0);
});
test('owner exclusion retires canonical and manual prices without changing unrelated products',()=>{
 const offer=reconcileEnrichedOffers([],[row],[record],now)[0];
 const canonical={...offer,id:'canonical',foodId:'yogurt'};
 const manual={...canonical,id:'manual',verification:'user' as const};
 const unrelated={...manual,id:'unrelated',name:'Другой йогурт 130г',sourceUrl:'https://proshoper.ru/kogalym/#other'};
 const excluded={...record,userExcluded:true};
 for(const price of [offer,canonical,manual]){
  const reconciled=reconcileEnrichedOffers([price,unrelated],[row],[excluded],now);
  assert.equal(reconciled.find(o=>o.id===price.id)?.status,'pending');
  assert.equal(reconciled.find(o=>o.id==='unrelated')?.status,'confirmed');
  assert.equal(enrichmentSummary([row],[excluded],reconciled,now).menuReady,1);
 }
 const summary=enrichmentSummary([row],[excluded],[],now);assert.equal(summary.excluded,1);assert.equal(summary.uniqueProducts,0);
});

test('an incoming price cannot reactivate an excluded card through a shared source slot',()=>{
 const offers=reconcileEnrichedOffers([],[row],[record],now);
 const other={...row,id:'another-card',name:'Йогурт Актибио ванильный 130г'};
 const otherRecord={...record,key:enrichmentKey(other),listingName:other.name,candidate:{...record.candidate!,productName:other.name}};
 const result=reconcileEnrichedOffers(offers,[row,other],[{...record,userExcluded:true},otherRecord],now);
 assert.equal(result[0].status,'pending');
});
