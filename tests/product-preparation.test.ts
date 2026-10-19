import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichedFood,enrichmentKey,preservePreparation,type ProductCandidate,type EnrichmentRecord} from '../lib/product-enrichment.ts';
import {productReviewView} from '../lib/product-review.ts';
import {foodIdentity,eligibleRecipeFoods} from '../lib/recipe-library.ts';
import {recipePreparationIssue} from '../lib/recipe-generation.ts';
import {resolveProductPreparation} from '../lib/product-preparation.ts';
import {mergeBulkRecords} from '../lib/bulk-enrichment.ts';
import type {CatalogListing} from '../lib/proshoper.ts';
const now=new Date('2026-10-19T16:00:00Z');
const row:CatalogListing={id:'local:1',name:'Пельмени Мираторг из мраморной говядины 700г',storeId:'magnit',sourceId:'local',sourceUrl:'https://proshoper.ru/kogalym/actions/magnit-magazin/#id_product_1',price:199,packGrams:700,packText:'700г',priceUnit:'pack',availability:'listed',observedAt:now.toISOString(),lastSeenAt:now.toISOString(),localEvidence:'Каталог Когалыма',evidence:'Цена 199 руб.'};
const candidate:ProductCandidate={productName:row.name,packGrams:700,macros:{kcal:240,protein:10,fat:12,carbs:23},sourceUrl:'https://magnit.ru/product/100001-pelmeni',observedAt:now.toISOString(),evidence:'Пищевая ценность на 100 г продукта'};
const record:EnrichmentRecord={key:enrichmentKey(row),listingName:row.name,status:'matched',candidate,checkedAt:now.toISOString(),retryAt:'2026-11-19T16:00:00Z',attempts:1,reason:'Проверены КБЖУ'};
const preparation={kind:'raw-prepared',sourceUrl:'https://miratorg.ru/products/pelmeni/',evidence:'Полуфабрикат замороженный. Варить в кипящей воде до готовности. Масса нетто без упаковки.',observedAt:now.toISOString()};
const request=()=>({foodId:`e-${record.key}`,expectedIdentity:foodIdentity(enrichedFood(row,candidate)!),preparation});

test('resolves a sourced preparation without replacing nutrition or claiming a human review',()=>{
 const result=resolveProductPreparation([row],[record],[request()],now);
 assert.equal(result.applied.length,1);assert.equal(result.rejected.length,0);
 const c=result.records[0].candidate!;assert.deepEqual(c.macros,candidate.macros);assert.equal(c.nutritionSourceUrl,candidate.nutritionSourceUrl);assert.notEqual(c.userVerified,true);
 const food=enrichedFood(row,c)!;assert.equal(food.kind,'raw-prepared');assert.equal(food.preparation?.sourceUrl,preparation.sourceUrl);assert.equal(recipePreparationIssue(food),undefined);assert.notEqual(foodIdentity(food),request().expectedIdentity);
});
test('rejects stale identities, private sources, future dates, missing evidence and owner decisions',()=>{
 for(const entry of [{...request(),expectedIdentity:'stale'},{...request(),preparation:{...preparation,sourceUrl:'http://localhost/secrets'}},{...request(),preparation:{...preparation,observedAt:'2099-01-01T00:00:00Z'}},{...request(),preparation:{...preparation,evidence:''}},{...request(),preparation:{...preparation,kind:'invented'}}])assert.equal(resolveProductPreparation([row],[record],[entry],now).applied.length,0);
 for(const r of [{...record,userExcluded:true},{...record,candidate:{...candidate,userVerified:true,reviewKind:'ingredient'}}])assert.equal(resolveProductPreparation([row],[r],[request()],now).applied.length,0);
});
test('an automatic nutrition refresh preserves the independently sourced preparation',()=>{
 const resolved=resolveProductPreparation([row],[record],[request()],now).records;
 const refreshed=mergeBulkRecords(resolved,[{row,result:{status:'matched',candidate:{...candidate,macros:{...candidate.macros!,protein:11}},reason:'Обновлена этикетка'}}],new Date(now.getTime()+60000));
 assert.deepEqual(refreshed[0].candidate?.preparation,preparation);assert.equal(refreshed[0].candidate?.macros?.protein,11);
});
test('a failed automatic relookup retains verified facts and resolved tasks do not award user XP',()=>{
 const resolved=resolveProductPreparation([row],[record],[request()],now).records;
 for(const status of ['not-found','ambiguous','error'] as const){const next=preservePreparation(row,resolved[0],{...record,status,candidate:undefined,reason:'Источник недоступен'});assert.equal(next.status,'matched');assert.deepEqual(next.candidate?.preparation,preparation);}
 const attempt={foodId:request().foodId,identity:request().expectedIdentity,status:'needs-review' as const,reason:'Уточните подготовку',checkedAt:now.toISOString(),retryAt:'2026-10-26T16:00:00Z'};
 assert.equal(productReviewView([row],[record],[],undefined,now,[attempt]).remaining,1);
 const review=productReviewView([row],resolved,[],undefined,now,[attempt]);assert.equal(review.remaining,0);assert.equal(review.stats.xp,0);assert.equal(review.stats.verified,0);
});
test('verified dry food preparation clears a role task without declaring it already cooked',()=>{
 const r={...row,name:'Пюре Доширак картофельное со вкусом курицы 40г',packGrams:40,packText:'40г'};
 const c={...candidate,productName:r.name,packGrams:40,preparation:{...preparation,kind:'ingredient',evidence:'Сухое картофельное пюре. Залить кипятком и перемешать.'}};
 const food=enrichedFood(r,c)!;assert.ok(food);assert.equal(food.kind,'ingredient');assert.equal(recipePreparationIssue(food),undefined);
 assert.match(recipePreparationIssue(enrichedFood(r,{...c,preparation:undefined})!)??'',/Уточните/);
});
test('non-swallowed chewing gum remains in the food registry but is not a recipe target',()=>{
 const r={...row,name:'Жевательная резинка мята Mentos 15.5г',packGrams:15.5,packText:'15.5г'};
 const c={...candidate,productName:r.name,packGrams:15.5,preparation:{...preparation,kind:'not-for-recipes',evidence:'Жевательная резинка с нерастворимой жевательной основой, не предназначенной для проглатывания.'}};
 const food=enrichedFood(r,c)!;assert.ok(food);assert.equal(food.kind,'not-for-recipes');
 const offer={id:'o',foodId:food.id,name:r.name,storeId:'magnit',price:30,packGrams:15.5,macros:c.macros!,observedAt:now.toISOString(),validUntil:'2026-10-20T16:00:00Z',sourceUrl:r.sourceUrl,evidence:'Цена',localConfirmed:true,nutritionEstimated:false,status:'confirmed' as const,demo:false};
 assert.equal(eligibleRecipeFoods([food],[offer],undefined,now).length,0);
});
