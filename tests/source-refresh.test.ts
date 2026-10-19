import test from 'node:test';
import assert from 'node:assert/strict';
import {knownRefreshQueue,discoveryQueue,applyKnownRefresh,refreshSnapshot,sourceFacts,trackDiscoveredSource,SOURCE_PARSER_VERSION} from '../lib/source-refresh.ts';
import {enrichmentKey,type EnrichmentRecord} from '../lib/product-enrichment.ts';
import type {CatalogListing} from '../lib/proshoper.ts';
const now=new Date('2026-10-19T15:00:00Z');
const row:CatalogListing={id:'local',name:'Йогурт Актибио натуральный 130г',price:49.99,packGrams:130,priceUnit:'pack',storeId:'5ka',sourceId:'source',sourceUrl:'https://proshoper.ru/kogalym/actions/5ka/#id_product_1',localEvidence:'Когалым',evidence:'49.99',availability:'listed',observedAt:now.toISOString(),lastSeenAt:now.toISOString()};
const record:EnrichmentRecord={key:enrichmentKey(row),listingName:row.name,status:'matched',attempts:1,checkedAt:'2026-10-18T00:00:00Z',retryAt:'2026-11-18T00:00:00Z',reason:'Точное совпадение',candidate:{productName:row.name,brand:'Актибио',packGrams:130,macros:{kcal:60,protein:5,fat:2,carbs:5.5},sourceUrl:'https://magnit.ru/product/12345-yogurt/',nutritionSourceUrl:'https://magnit.ru/product/12345-yogurt/',observedAt:'2026-10-18T00:00:00Z',estimated:false}};
const success=(candidate=record.candidate!)=>({status:'ok' as const,candidate,validators:{etag:'"v1"'},transport:'direct' as const});
test('existing matches migrate to known source queue; discovery only sees unresolved/new products',()=>{
 assert.equal(knownRefreshQueue([row],[record],now).length,1);
 assert.equal(discoveryQueue([row],[record],[],now).length,0);
 const unresolved={...row,id:'new',name:'Йогурт Бренд 130г'};
 assert.deepEqual(discoveryQueue([row,unresolved],[record],[],now).map(r=>r.id),['new']);
 const checked=applyKnownRefresh(row,record,refreshSnapshot(record),success(),now)!;
 assert.equal(knownRefreshQueue([row],[checked],now).length,0);
 assert.equal(checked.sourceRefresh?.binding.productId,'12345');
 assert.equal(checked.sourceRefresh?.status,'current');
});
test('unchanged successful checks advance check time without inventing a fact change',()=>{
 const next=applyKnownRefresh(row,record,refreshSnapshot(record),success({...record.candidate!,observedAt:now.toISOString(),evidence:'new HTML whitespace'}),now)!;
 assert.equal(next.sourceRefresh?.changes.length,0);
 assert.equal(next.sourceRefresh?.lastChangedAt,record.candidate!.observedAt);
 assert.equal(next.sourceRefresh?.lastCheckedAt,now.toISOString());
 assert.equal(next.candidate?.observedAt,now.toISOString());
 const notModified=applyKnownRefresh(row,next,refreshSnapshot(next),{status:'unchanged',validators:{etag:'"v1"'},transport:'direct'},new Date(now.getTime()+86400000))!;
 assert.equal(notModified.sourceRefresh?.changes.length,0);
 assert.equal(notModified.sourceRefresh?.lastSuccessAt,'2026-10-20T15:00:00.000Z');
});
test('changed nutrition stores semantic before/after and preserves independent preparation evidence',()=>{
 const withPrep={...record,candidate:{...record.candidate!,preparation:{kind:'yogurt',sourceUrl:'https://actibio-club.ru/product',evidence:'Готовый к употреблению натуральный йогурт',observedAt:record.checkedAt}}};
 const next=applyKnownRefresh(row,withPrep,refreshSnapshot(withPrep),success({...record.candidate!,macros:{kcal:64,protein:6,fat:2,carbs:5.5}}),now)!;
 assert.equal(next.candidate?.macros?.protein,6);
 assert.equal(next.candidate?.preparation?.kind,'yogurt');
 assert.deepEqual(next.sourceRefresh?.changes[0].fields,['macros']);
 assert.equal(next.sourceRefresh?.changes[0].before.macros?.protein,5);
 assert.equal(next.sourceRefresh?.changes[0].after.macros?.protein,6);
 assert.equal(next.sourceRefresh?.lastChangedAt,now.toISOString());
});
test('transient failures preserve good facts and never trigger discovery',()=>{
 const next=applyKnownRefresh(row,record,refreshSnapshot(record),{status:'error',reason:'HTTP 503'},now)!;
 assert.deepEqual(next.candidate,record.candidate);
 assert.equal(next.sourceRefresh?.status,'stale');
 assert.equal(discoveryQueue([row],[next],[],new Date(now.getTime()+3600001)).length,0);
 assert.equal(knownRefreshQueue([row],[next],new Date(now.getTime()+3600001)).length,1);
});
test('missing source and changed identity allow separate discovery but retain previous facts',()=>{
 for(const result of [{status:'missing' as const,reason:'HTTP 404'},success({...record.candidate!,productName:'Йогурт Актибио клубника 130г'})]){
  const next=applyKnownRefresh(row,record,refreshSnapshot(record),result,now)!;
  assert.deepEqual(next.candidate,record.candidate);
  assert.ok(['missing','invalid'].includes(next.sourceRefresh!.status));
  assert.equal(discoveryQueue([row],[next],[],now).length,1);
 }
});
test('owner facts are checked for conflicts without overwrite, exclusion and in-flight edits are protected',()=>{
 const reviewed={...record,candidate:{...record.candidate!,userVerified:true,reviewKind:'yogurt'}};
 const next=applyKnownRefresh(row,reviewed,refreshSnapshot(reviewed),success({...record.candidate!,macros:{kcal:99,protein:10,fat:2,carbs:5.5}}),now)!;
 assert.deepEqual(next.candidate,reviewed.candidate);
 assert.equal(next.sourceRefresh?.status,'conflict');
 assert.equal(discoveryQueue([row],[next],[],now).length,0);
 assert.equal(applyKnownRefresh(row,reviewed,refreshSnapshot(record),success(),now),undefined);
 assert.equal(applyKnownRefresh(row,{...record,userExcluded:true},refreshSnapshot(record),success(),now),undefined);
 const rebound={...record,candidate:{...record.candidate!,sourceUrl:'https://magnit.ru/product/98765-yogurt/',nutritionSourceUrl:'https://magnit.ru/product/98765-yogurt/'}};
 assert.equal(applyKnownRefresh(row,rebound,refreshSnapshot(record),success(),now),undefined);
});
test('fact fingerprint ignores timestamps and evidence but includes nutrition, identity and quantity',()=>{
 assert.deepEqual(sourceFacts(record.candidate!),sourceFacts({...record.candidate!,evidence:'changed',observedAt:now.toISOString()}));
 assert.notDeepEqual(sourceFacts(record.candidate!),sourceFacts({...record.candidate!,packGrams:150}));
 assert.deepEqual(sourceFacts(record.candidate!),sourceFacts({...record.candidate!,productName:'Йогурт Актибио натуральный130 г'}));
});
test('a source omitting an already verified brand does not erase the known identity or create a change',()=>{
 const next=applyKnownRefresh(row,record,refreshSnapshot(record),success({...record.candidate!,brand:undefined}),now)!;
 assert.equal(next.candidate?.brand,'Актибио');assert.equal(next.sourceRefresh?.changes.length,0);
});
test('owner conflict survives a temporary outage followed by a 304 response',()=>{
 const reviewed={...record,candidate:{...record.candidate!,userVerified:true,reviewKind:'yogurt'}};
 const conflict=applyKnownRefresh(row,reviewed,refreshSnapshot(reviewed),success({...record.candidate!,macros:{kcal:64,protein:6,fat:2,carbs:5.5}}),now)!;
 const outage=applyKnownRefresh(row,conflict,refreshSnapshot(conflict),{status:'error',reason:'HTTP 503'},now)!;
 const restored=applyKnownRefresh(row,outage,refreshSnapshot(outage),{status:'unchanged',validators:{etag:'"v1"'},transport:'direct'},now)!;
 assert.equal(restored.sourceRefresh?.status,'conflict');assert.equal(restored.candidate?.macros?.protein,5);
});
test('a parser upgrade refreshes metadata once and never reuses obsolete version or source binding',()=>{
 const checked=applyKnownRefresh(row,record,refreshSnapshot(record),success(),now)!;
 checked.sourceRefresh!.parserVersion=0;
 assert.equal(knownRefreshQueue([row],[checked],now).length,1);
 const upgraded=applyKnownRefresh(row,checked,refreshSnapshot(checked),success(),now)!;
 assert.equal(upgraded.sourceRefresh?.parserVersion,SOURCE_PARSER_VERSION);
 assert.equal(knownRefreshQueue([row],[upgraded],now).length,0);
});
test('a source returning to owner facts logs the reversal and discovery preserves earlier history',()=>{
 const reviewed={...record,candidate:{...record.candidate!,userVerified:true,reviewKind:'yogurt'}};
 const conflict=applyKnownRefresh(row,reviewed,refreshSnapshot(reviewed),success({...record.candidate!,macros:{kcal:64,protein:6,fat:2,carbs:5.5}}),now)!;
 const later=new Date(now.getTime()+86400000);
 const restored=applyKnownRefresh(row,conflict,refreshSnapshot(conflict),success(),later)!;
 assert.equal(restored.sourceRefresh?.status,'current');assert.equal(restored.sourceRefresh?.changes.length,2);
 assert.equal(restored.sourceRefresh?.changes[0].before.macros?.protein,6);
 assert.equal(restored.sourceRefresh?.lastChangedAt,later.toISOString());
 const repaired=trackDiscoveredSource(row,restored,{...record,candidate:{...record.candidate!,sourceUrl:'https://magnit.ru/product/98765-yogurt/',nutritionSourceUrl:'https://magnit.ru/product/98765-yogurt/'}});
 assert.equal(repaired.sourceRefresh?.changes.length,3);
 assert.equal(repaired.sourceRefresh?.binding.productId,'98765');
 assert.deepEqual(repaired.sourceRefresh?.validators,{});
});
