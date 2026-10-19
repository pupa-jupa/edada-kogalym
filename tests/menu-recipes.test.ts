import test from 'node:test';
import assert from 'node:assert/strict';
import type {Food, Offer, PlanInput} from '../lib/domain.ts';
import type {CatalogListing} from '../lib/proshoper.ts';
import type {EnrichmentRecord} from '../lib/product-enrichment.ts';
import {enrichmentKey} from '../lib/product-enrichment.ts';
import {allFoods, menuRecipes} from '../lib/menu-recipes.ts';
import {optimizeMenu} from '../lib/optimizer.ts';
import {FOODS} from '../lib/catalog.ts';

const now=new Date('2026-10-19T12:00:00Z');
const input=(patch:Partial<PlanInput>={}):PlanInput=>({budget:300,proteinMin:25,proteinTolerance:0,meals:1,maxMinutes:40,storeIds:['magnit'],excludedFoodIds:[],demo:false,...patch});
const food=(id:string,kind:string,protein=10):Food=>({id,name:id,kind,emoji:'🍲',category:'Тест',allergens:[],macros:{kcal:200,protein,fat:2,carbs:20}});
const offer=(f:Food,patch:Partial<Offer>={}):Offer=>({id:'offer-'+f.id,foodId:f.id,name:f.name,storeId:'magnit',price:60,packGrams:400,macros:f.macros,observedAt:'2026-10-18T12:00:00Z',validUntil:'2026-10-25T12:00:00Z',sourceUrl:'https://magnit.ru/product/test',evidence:'Этикетка',localConfirmed:true,nutritionEstimated:false,status:'confirmed',demo:false,...patch});

test('a cooking template cannot duplicate a built-in dish with the same ingredient proportions',()=>{
 const foods=allFoods([],[]);const selected=foods.filter(f=>['oats','cottage-fatfree','rice','tuna'].includes(f.id));
 const recipes=menuRecipes(foods,selected.map(f=>offer(f)),input({budget:1000,meals:3}),now);
 const signature=(r:typeof recipes[number])=>{const total=r.ingredients.reduce((n,i)=>n+i.grams,0);return r.ingredients.map(i=>i.foodId+':'+(i.grams/total).toFixed(6)).sort().join('|');};
 assert.equal(new Set(recipes.map(signature)).size,recipes.length);
});

test('matched enrichment registers stable product food once and ignores stale or invalid identities',()=>{
 const row:CatalogListing={id:'p',name:'Макароны Barilla спагетти 500г',storeId:'magnit',sourceId:'s',sourceUrl:'https://magnit.ru/product/1',price:90,packGrams:500,priceUnit:'pack',availability:'listed',observedAt:now.toISOString(),lastSeenAt:now.toISOString(),localEvidence:'Когалым',evidence:'Карточка'};
 const record:EnrichmentRecord={key:enrichmentKey(row),listingName:row.name,status:'matched',checkedAt:now.toISOString(),retryAt:'2026-11-01T00:00:00Z',attempts:1,reason:'matched',candidate:{productName:row.name,brand:'Barilla',packGrams:500,macros:{kcal:350,protein:12,fat:1.5,carbs:72},sourceUrl:'https://www.barilla.com/product/1',observedAt:now.toISOString(),estimated:false}};
 const foods=allFoods([record,{...record,key:'wrong'},{...record,status:'ambiguous'}],[row,{...row,id:'other-store',storeId:'5ka'}]);
 const extra=foods.filter(f=>f.id.startsWith('e-'));
 assert.equal(extra.length,1);
 assert.equal(extra[0].id,'e-'+enrichmentKey(row));
 assert.equal(extra[0].kind,'pasta');
 assert.equal(foods.length,FOODS.length+1);
 assert.equal(foods.find(f=>f.id==='rice')?.kind,'grain');
 assert.equal(FOODS.find(f=>f.id==='rice')?.kind,undefined);
});

test('previously unusable product pasta becomes a cooked menu with exact whole-package checkout',()=>{
 const pasta=food('e-new-pasta','pasta',12),fish=food('e-new-fish','canned-fish',25);
 const offers=[offer(pasta,{price:80,packGrams:450}),offer(fish,{price:120,packGrams:200})];
 const recipes=menuRecipes([pasta,fish],offers,input(),now);
 assert.ok(recipes.some(r=>r.ingredients.some(i=>i.foodId===pasta.id)&&r.ingredients.some(i=>i.foodId===fish.id)));
 assert.ok(recipes.flatMap(r=>r.steps).some(s=>/вар|отвар/i.test(s)));
 const result=optimizeMenu(input(),offers,recipes,now);
 assert.equal(result.feasible,true);
 assert.equal(result.totalCost,200);
 assert.equal(result.shopping.length,2);
 assert.ok(result.shopping.every(s=>s.packs===1&&s.purchasedGrams===s.offer.packGrams));
 assert.ok(result.meals[0].recipe.ingredients.some(i=>i.foodId===pasta.id));
});

test('eligibility removes expired, future, excluded and other-store products before ranking',()=>{
 const pasta=food('pasta-new','pasta'),fish=food('fish-new','canned-fish',25),unknown=food('unclassified','mystery',50);
 const base=[offer(pasta),offer(fish),offer(unknown)];
 for(const bad of [
  {...base[1],validUntil:'2026-10-18T00:00:00Z'},
  {...base[1],storeId:'5ka'},
  {...base[1],validFrom:'2026-10-20T00:00:00Z'},
  {...base[1],observedAt:'2026-10-20T00:00:00Z'},
  {...base[1],status:'pending' as const},
 ]){
  const recipes=menuRecipes([pasta,fish,unknown],[base[0],bad,base[2]],input(),now);
  assert.ok(recipes.every(r=>r.ingredients.every(i=>i.foodId!==fish.id&&i.foodId!==unknown.id)));
 }
 const recipes=menuRecipes([pasta,fish],base,input({excludedFoodIds:[fish.id]}),now);
 assert.ok(recipes.every(r=>r.ingredients.every(i=>i.foodId!==fish.id)));
});

test('many curd products cannot starve a lean fish meal and missing foods never appear',()=>{
 const foods=[...Array.from({length:30},(_,i)=>food('curd-'+i,'curd',15)),food('grain','grain',6),food('fish','raw-fillet',23),food('fruit','fruit',1)];
 const offers=foods.map(f=>offer(f,{price:f.id==='fish'?90:40}));
 const recipes=menuRecipes(foods,offers,input({proteinMin:60,fatMax:15,carbsMax:100}),now);
 assert.ok(recipes.length<=12);
 assert.ok(recipes.some(r=>r.ingredients.some(i=>i.foodId==='fish')));
 assert.ok(recipes.every(r=>r.ingredients.every(i=>foods.some(f=>f.id===i.foodId))));
 assert.deepEqual(menuRecipes(foods,offers,input({proteinMin:60,fatMax:15,carbsMax:100}),now),recipes);
 assert.ok(recipes.filter(r=>r.ingredients.some(i=>i.foodId.startsWith('curd-'))).length<=4);
});

test('raw meat and seafood are cooked with safety temperatures and no phantom ingredients',()=>{
 for(const kind of ['raw-fillet','raw-meat','raw-seafood']){
  const raw={...food('raw-'+kind,kind,22),name:kind==='raw-fillet'?'Филе куриное':'Филе рыбы'};
  const grain={...food('rice-new','grain'),name:'Рис сухой'};
  const recipes=menuRecipes([raw,grain],[offer(raw),offer(grain)],input(),now);
  const paired=recipes.find(r=>r.ingredients.some(i=>i.foodId===raw.id));
  assert.ok(paired);
  assert.ok(paired.steps.some(s=>s.includes(kind==='raw-seafood'?'63':'74')));
  assert.ok(paired.steps.some(s=>/вар|готов/i.test(s)));
  assert.ok(paired.ingredients.every(i=>[raw.id,grain.id].includes(i.foodId)));
  assert.ok(!paired.steps.join(' ').match(/масл|соль|спец|перец/));
 }
});

test('existing eligible built-in recipes survive and cooking time is respected',()=>{
 const foods=allFoods([],[]);
 const needed=foods.filter(f=>['oats','cottage-fatfree'].includes(f.id));
 const offers=needed.map(f=>offer(f));
 const recipes=menuRecipes(foods,offers,input({maxMinutes:15}),now);
 assert.ok(recipes.some(r=>r.id==='curd-oats-water'));
 assert.ok(recipes.every(r=>r.minutes<=15));
 assert.deepEqual(menuRecipes(foods,offers,input({maxMinutes:0}),now),[]);
});

test('many grain brands cannot hide the oats needed for yogurt breakfast',()=>{
 const grains=Array.from({length:20},(_,i)=>({...food('buckwheat-'+i,'grain',14),name:'Гречка Увелка '+i}));
 const oats={...food('oats-brand','grain',10),name:'Хлопья овсяные Царь'};
 const yogurt=food('yogurt-brand','yogurt',8);
 const foods=[...grains,oats,yogurt];
 const recipes=menuRecipes(foods,foods.map(f=>offer(f)),input({maxMinutes:20}),now);
 assert.ok(recipes.some(r=>r.ingredients.some(i=>i.foodId===oats.id)&&r.ingredients.some(i=>i.foodId===yogurt.id)));
 assert.ok(recipes.filter(r=>r.ingredients.some(i=>i.foodId===oats.id)).every(r=>r.steps.some(s=>/отвар/i.test(s))));
});

test('budget and fat caps rank different meals using actual offer labels',()=>{
 const pasta=food('pasta-brand','pasta',12),lean=food('lean','canned-fish',24),rich=food('rich','canned-fish',24);
 const foods=[pasta,lean,rich];
 const offers=[offer(pasta,{price:20}),offer(lean,{price:160,macros:{kcal:100,protein:24,fat:1,carbs:0}}),offer(rich,{price:25,macros:{kcal:300,protein:24,fat:24,carbs:0}})];
 const firstPair=(p:PlanInput)=>menuRecipes(foods,offers,p,now).find(r=>r.ingredients.length===2)!;
 assert.ok(firstPair(input({budget:60})).ingredients.some(i=>i.foodId==='rich'));
 assert.ok(firstPair(input({budget:300,fatMax:6})).ingredients.some(i=>i.foodId==='lean'));
});

