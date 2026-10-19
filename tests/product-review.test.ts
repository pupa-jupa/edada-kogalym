import test from 'node:test';
import assert from 'node:assert/strict';
import type {CatalogListing} from '../lib/proshoper.ts';
import type {EnrichmentRecord} from '../lib/product-enrichment.ts';
import {enrichedFood,enrichedOffer,enrichmentKey} from '../lib/product-enrichment.ts';
import * as api from '../lib/product-review.ts';
import {listingToOffer} from '../lib/catalog-sync.ts';
import {reconcileEnrichedOffers} from '../lib/enrichment.ts';
import {foodIdentity,type GenerationAttempt} from '../lib/recipe-library.ts';
const now=new Date('2026-10-19T12:00:00Z');
const row=(changes:Partial<CatalogListing>={}):CatalogListing=>({id:'review-1',name:'Киноа',storeId:'magnit',sourceId:'local',sourceUrl:'https://proshoper.ru/kogalym/actions/magnit-magazin/',price:100,priceUnit:'pack',availability:'listed',observedAt:now.toISOString(),lastSeenAt:now.toISOString(),localEvidence:'Каталог Когалыма',evidence:'Цена карточки',...changes});
function command(r=row(),records:EnrichmentRecord[]=[]){const task=api.productReviewView([r],records,[],undefined,now).tasks[0];return {operation:'confirm' as const,key:task.key,fingerprint:task.fingerprint,kind:'grain' as const,packGrams:400,macros:{kcal:368,protein:14,fat:6,carbs:64},nutritionSourceUrl:'https://brand.example/quinoa',labelEvidence:'Этикетка этой пачки: значения на 100 г сухого продукта',confirmed:true as const};}

test('review queue is bounded, deduplicated, and never invents nutrition',()=>{
 const rows=Array.from({length:20},(_,i)=>row({id:String(i),name:`Киноа ${i}`}));
 const view=api.productReviewView([...rows,rows[0]],[],[],undefined,now);
 assert.equal(view.tasks.length,12);assert.equal(view.remaining,20);assert.equal(view.tasks[0].candidate,undefined);assert.equal(view.stats.xp,0);
});

test('a large nutrition backlog cannot hide other review task types from the visible set',()=>{
 const rows=Array.from({length:30},(_,i)=>row({id:String(i),name:`Киноа ${i}`}));
 const view=api.productReviewView([...rows,row({id:'nonfood',name:'Шампунь 300мл'})],[],[],undefined,now);
 assert.equal(view.remaining,31);assert.equal(view.tasks.length,12);assert.ok(view.tasks.some(task=>task.issue==='nonfood'));
});
test('owner confirmation admits an unknown single-word food with exact identity and declared role',()=>{
 const r=row();const result=api.applyProductReview([r],[],undefined,command(r),now);
 const record=result.enrichment[0];assert.equal(record.candidate?.productName,'Киноа');assert.equal(record.candidate?.userVerified,true);assert.equal(enrichedFood(r,record.candidate!)?.kind,'grain');assert.equal(enrichedOffer(r,record,now)?.packGrams,400);assert.equal(api.productReviewView([r],result.enrichment,[],result.ledger,now).tasks.length,0);
});
test('rejects stale nutrition or record versions without modifying stored facts',()=>{
 const r=row();const cmd=command(r);const record:EnrichmentRecord={key:enrichmentKey(r),listingName:r.name,status:'error',checkedAt:now.toISOString(),retryAt:now.toISOString(),attempts:2,reason:'New provider result'};
 assert.throws(()=>api.applyProductReview([r],[record],undefined,cmd,now),/измен|устар/i);
});
test('requires complete explicit nutrition, public provenance, evidence, and positive literal mass',()=>{
 const r=row();const cmd=command(r);
 for(const change of [{macros:{kcal:368,protein:14,fat:6}},{packGrams:0},{packGrams:25000},{nutritionSourceUrl:'https://localhost/private'},{labelEvidence:''},{kind:'invented'},{confirmed:false}])assert.throws(()=>api.applyProductReview([r],[],undefined,{...cmd,...change} as never,now),JSON.stringify(change));
 const known=row({name:'Киноа 400г',packGrams:400});assert.throws(()=>api.applyProductReview([known],[],undefined,{...command(known),packGrams:500},now),/масс|фасов/i);
});
test('manual mass for count or volume is explicit edible mass rather than automatic density',()=>{
 const r=row({name:'Кефир 1л',packText:'1л'});const result=api.applyProductReview([r],[],undefined,{...command(r),kind:'ingredient',packGrams:1020},now);
 const offer=enrichedOffer(r,result.enrichment[0],now);assert.equal(offer?.packGrams,1020);assert.match(offer?.quantityNote??'',/пользовател|вручную/i);
});
test('manual review cannot grant nonfood a culinary role',()=>{
 const r=row({name:'Шампунь'});assert.throws(()=>api.applyProductReview([r],[],undefined,command(r),now),/пищ|исключ/i);
});
test('skip lasts until tomorrow and earns no penalty or points',()=>{
 const r=row(),cmd=command(r);const result=api.applyProductReview([r],[],undefined,{operation:'skip',key:cmd.key,fingerprint:cmd.fingerprint},now);
 assert.equal(api.productReviewView([r],[],[],result.ledger,now).tasks.length,0);assert.equal(api.productReviewView([r],[],[],result.ledger,new Date('2026-10-20T12:00:00Z')).tasks.length,1);assert.equal(api.productReviewView([r],[],[],result.ledger,now).stats.xp,0);
});
test('exclude preserves the previous record and undo restores it without overwriting automatic changes',()=>{
 const r=row();const previous:EnrichmentRecord={key:enrichmentKey(r),listingName:r.name,status:'not-found',checkedAt:now.toISOString(),retryAt:now.toISOString(),attempts:1,reason:'Raw provider reason'};
 const cmd=command(r,[previous]);const excluded=api.applyProductReview([r],[previous],undefined,{operation:'exclude',key:cmd.key,fingerprint:cmd.fingerprint},now);
 assert.equal(excluded.enrichment[0].userExcluded,true);assert.equal(excluded.enrichment[0].reason,'Raw provider reason');
 const undone=api.applyProductReview([r],excluded.enrichment,excluded.ledger,{operation:'undo',key:cmd.key},now);assert.deepEqual(undone.enrichment,[previous]);
 const newer={...excluded.enrichment[0],checkedAt:'2026-10-19T13:00:00Z',reason:'New automatic result'};
 assert.throws(()=>api.applyProductReview([r],[newer],excluded.ledger,{operation:'undo',key:cmd.key},now),/измен|нов/i);
});
test('repeat, undo, and reconfirm cannot farm points',()=>{
 const r=row(),cmd=command(r);const first=api.applyProductReview([r],[],undefined,cmd,now);const repeat=api.applyProductReview([r],first.enrichment,first.ledger,cmd,now);
 assert.equal(api.productReviewView([r],repeat.enrichment,[],repeat.ledger,now).stats.xp,10);
 const undone=api.applyProductReview([r],first.enrichment,first.ledger,{operation:'undo',key:cmd.key},now);
 const again=api.applyProductReview([r],undone.enrichment,undone.ledger,command(r,undone.enrichment),now);
 assert.equal(api.productReviewView([r],again.enrichment,[],again.ledger,now).stats.xp,10);assert.equal(api.productReviewView([r],again.enrichment,[],again.ledger,now).stats.dailyDone,1);
});
test('routine source-check metadata does not prevent undoing an unchanged owner confirmation',()=>{
 const r=row(),cmd=command(r);const first=api.applyProductReview([r],[],undefined,cmd,now);
 const refreshed={...first.enrichment[0],checkedAt:'2026-10-20T12:00:00Z',retryAt:'2026-10-27T12:00:00Z',attempts:12};
 const undone=api.applyProductReview([r],[refreshed],first.ledger,{operation:'undo',key:cmd.key},now);
 assert.equal(undone.enrichment.length,0);
 const edited={...refreshed,candidate:{...refreshed.candidate!,macros:{...refreshed.candidate!.macros!,protein:99}}};
 assert.throws(()=>api.applyProductReview([r],[edited],first.ledger,{operation:'undo',key:cmd.key},now),/измен|нов/i);
});

test('changed payload cannot use an already-applied confirmation fingerprint',()=>{
 const r=row(),cmd=command(r);const first=api.applyProductReview([r],[],undefined,cmd,now);
 assert.throws(()=>api.applyProductReview([r],first.enrichment,first.ledger,{...cmd,macros:{...cmd.macros,kcal:360}},now),/измен|устар/i);
});
test('daily goal and skip boundaries follow Kogalym local midnight',()=>{
 const evening=new Date('2026-10-19T18:59:00Z'),r=row(),cmd=command(r);
 const confirmed=api.applyProductReview([r],[],undefined,cmd,evening);
 assert.equal(api.productReviewView([r],confirmed.enrichment,[],confirmed.ledger,new Date('2026-10-19T19:01:00Z')).stats.dailyDone,0);
 const skipped=api.applyProductReview([r],[],undefined,{operation:'skip',key:cmd.key,fingerprint:cmd.fingerprint},evening);
 assert.equal(api.productReviewView([r],[],[],skipped.ledger,new Date('2026-10-19T19:01:00Z')).tasks.length,1);
});
test('explicit zero label values are retained while omitted nutrients remain invalid',()=>{
 const r=row({name:'Соль'});const result=api.applyProductReview([r],[],undefined,{...command(r),kind:'ingredient',macros:{kcal:0,protein:0,fat:0,carbs:0}},now);
 assert.deepEqual(result.enrichment[0].candidate?.macros,{kcal:0,protein:0,fat:0,carbs:0});
});
test('undo exclusion restores canonical and manual prices across persisted reconciliation',()=>{
 assert.equal(typeof api.applyProductReviewWithOffers,'function');
 const r=row({name:'Рис Мистраль 400г',packGrams:400,packText:'400г'}),cmd=command(r),canonical=listingToOffer(r,now)!;
 for(const offer of [canonical,{...canonical,verification:'user' as const}]){
  const excluded=api.applyProductReviewWithOffers([r],[],[offer],undefined,{operation:'exclude',key:cmd.key,fingerprint:cmd.fingerprint},now);
  assert.equal(excluded.offers[0].status,'pending');
  const persisted=reconcileEnrichedOffers(JSON.parse(JSON.stringify(excluded.offers)),[r],excluded.enrichment,now);
  const retried=api.applyProductReviewWithOffers([r],excluded.enrichment,persisted,JSON.parse(JSON.stringify(excluded.ledger)),{operation:'exclude',key:cmd.key,fingerprint:cmd.fingerprint},now);
  const undone=api.applyProductReviewWithOffers([r],retried.enrichment,retried.offers,retried.ledger,{operation:'undo',key:cmd.key},now);
  assert.equal(undone.offers[0].status,'confirmed');assert.equal(undone.offers[0].price,100);
  const repeated=api.applyProductReviewWithOffers([r],undone.enrichment,undone.offers,undone.ledger,{operation:'undo',key:cmd.key},now);assert.deepEqual(repeated.offers,undone.offers);
 }
});
test('undo exclusion preserves newer manual prices and does not recreate deleted offers',()=>{
 assert.equal(typeof api.applyProductReviewWithOffers,'function');
 const r=row({name:'Рис Мистраль 400г',packGrams:400,packText:'400г'}),cmd=command(r),offer={...listingToOffer(r,now)!,verification:'user' as const};
 const excluded=api.applyProductReviewWithOffers([r],[],[offer],undefined,{operation:'exclude',key:cmd.key,fingerprint:cmd.fingerprint},now);
 const newer={...excluded.offers[0],price:120,observedAt:'2026-10-19T12:01:00Z'};
 const undone=api.applyProductReviewWithOffers([r],excluded.enrichment,[newer],excluded.ledger,{operation:'undo',key:cmd.key},now);
 assert.deepEqual(undone.offers,[newer]);
 const deleted=api.applyProductReviewWithOffers([r],excluded.enrichment,[],excluded.ledger,{operation:'undo',key:cmd.key},now);assert.deepEqual(deleted.offers,[]);
});
test('a current AI needs-review result exposes a complete known food with its actual reason',()=>{
 const r=row({name:'Рис Мистраль 400г',packGrams:400,packText:'400г'});
 const record:EnrichmentRecord={key:enrichmentKey(r),listingName:r.name,status:'matched',checkedAt:now.toISOString(),retryAt:now.toISOString(),attempts:1,reason:'Matched',candidate:{productName:r.name,packGrams:400,macros:{kcal:350,protein:7,fat:1,carbs:78},sourceUrl:'https://brand.example/rice',observedAt:now.toISOString()}};
 const food=enrichedFood(r,record.candidate!)!;assert.ok(food);
 const attempt:GenerationAttempt={foodId:food.id,identity:foodIdentity(food),checkedAt:now.toISOString(),retryAt:now.toISOString(),status:'needs-review',reason:'Уточните, рис сухой или уже приготовленный'};
 assert.equal(api.productReviewView([r],[record],[],undefined,now).tasks.length,0);
 const view=api.productReviewView([r],[record],[],undefined,now,[attempt]);assert.equal(view.tasks.length,1);assert.equal(view.tasks[0].issue,'role');assert.equal(view.tasks[0].reason,'Уточните, рис сухой или уже приготовленный');
 assert.equal(api.productReviewView([r],[record],[],undefined,now,[{...attempt,identity:'old-identity'}]).tasks.length,0);
 assert.equal(api.productReviewView([r],[record],[],undefined,now,[attempt,{...attempt,checkedAt:'2026-10-19T12:01:00Z',status:'error'}]).tasks.length,0);
});
