import test from 'node:test';
import assert from 'node:assert/strict';
import type {Food,Offer,PlanInput,Recipe} from '../lib/domain.ts';
import {foodIdentity,eligibleRecipeOffers,eligibleRecipeFoods,validSavedRecipes,saveGeneratedRecipes,nextRecipeTargets,recipeCoverage} from '../lib/recipe-library.ts';

const now=new Date('2026-10-19T12:00:00Z');
const food=(id:string):Food=>({id,name:'Продукт '+id,kind:'ingredient',category:'Продукты',emoji:'🥣',allergens:[],macros:{kcal:100,protein:20,fat:2,carbs:3}});
const offer=(product:Food,patch:Partial<Offer>={}):Offer=>({id:'offer-'+product.id,foodId:product.id,name:product.name,storeId:'magnit',price:50,packGrams:500,macros:product.macros,status:'confirmed',localConfirmed:true,nutritionEstimated:false,demo:false,observedAt:'2026-10-18T12:00:00Z',validUntil:'2026-10-25T12:00:00Z',sourceUrl:'https://example.com/product',evidence:'Этикетка',...patch});
const recipe=(id:string,foodId:string):Recipe=>({id,name:'Блюдо '+id,description:'Рецепт',emoji:'🥣',minutes:10,ingredients:[{foodId,grams:100}],steps:['Отмерьте продукт.','Приготовьте по инструкции на упаковке.'],tags:[]});
const input:PlanInput={budget:100,proteinMin:20,proteinTolerance:0,meals:1,maxMinutes:40,storeIds:['magnit'],excludedFoodIds:[],demo:false};

test('prompt facts include only offers eligible for the same plan context',()=>{
 const x=food('x');const current=offer(x,{id:'current',price:100});
 const offers=[offer(x,{id:'expired',price:1,validUntil:now.toISOString()}),offer(x,{id:'wrong-store',storeId:'other'}),offer(x,{id:'future',observedAt:'2026-10-20T00:00:00Z'}),current];
 assert.deepEqual(eligibleRecipeOffers(offers,input,now).map(o=>o.id),['current']);
});

test('captured entries cannot overwrite recipes saved against a newer product identity',()=>{
 const old=food('x'),current={...old,kind:'ready-meat'};
 const captured=saveGeneratedRecipes([],[recipe('old','x')],[old],'gemini-test',now);
 const newer=saveGeneratedRecipes([],[{...recipe('new','x'),ingredients:[{foodId:'x',grams:150}]}],[current],'gemini-test',now);
 const merged=saveGeneratedRecipes([...newer,...captured],[],[current],'gemini-test',now);
 assert.deepEqual(merged,newer);
});

test('recipe identity tracks preparation and product identity without mutable nutrition',()=>{
 const product=food('x');
 assert.equal(foodIdentity(product),foodIdentity({...product,macros:{...product.macros,protein:18}}));
 assert.notEqual(foodIdentity(product),foodIdentity({...product,name:'Другой продукт'}));
 assert.notEqual(foodIdentity(product),foodIdentity({...product,kind:'raw-meat'}));
 assert.notEqual(foodIdentity(product),foodIdentity({...product,allergens:['Молоко']}));
});

test('all eligible categories and products beyond 120 enter uncovered targets',()=>{
 const foods=Array.from({length:150},(_,index)=>food('food-'+String(index).padStart(3,'0')));
 const offers=foods.map(product=>offer(product));
 const saved=saveGeneratedRecipes([],foods.slice(0,149).map(product=>recipe(product.id,product.id)),foods,'gemini-test',now);
 assert.equal(eligibleRecipeFoods(foods,offers,undefined,now).length,150);
 assert.deepEqual(nextRecipeTargets(foods,offers,saved,[],8,now).map(product=>product.id),['food-149']);
 assert.deepEqual(recipeCoverage(foods,offers,saved,[],[],now),{eligibleFoods:150,coveredFoods:149,generatedRecipes:149,pendingFoods:1,needsReview:0,failedFoods:0});
});

test('saved recipes survive price expiry and use updated offer facts after prices return',()=>{
 const product=food('x');const saved=saveGeneratedRecipes([],[recipe('original','x')],[product],'gemini-test',now);
 assert.equal(validSavedRecipes(saved,[product],[offer(product)],input,now).length,1);
 assert.equal(validSavedRecipes(saved,[product],[offer(product,{validUntil:now.toISOString()})],input,now).length,0);
 assert.equal(saved.length,1);
 assert.equal(validSavedRecipes(saved,[{...product,macros:{...product.macros,protein:18}}],[offer(product,{price:90})],input,now).length,1);
 assert.equal(validSavedRecipes(saved,[{...product,kind:'raw-meat'}],[offer(product)],input,now).length,0);
 assert.equal(validSavedRecipes(saved,[product],[offer(product)],{...input,excludedFoodIds:['x']},now).length,0);
});

test('library validates ingredient IDs, deduplicates compositions and ignores model IDs',()=>{
 const x=food('x'),y=food('y');
 const first={...recipe('model-one','x'),ingredients:[{foodId:'x',grams:100},{foodId:'y',grams:50}]};
 const duplicate={...first,id:'model-two',ingredients:[{foodId:'y',grams:100},{foodId:'x',grams:200}]};
 const saved=saveGeneratedRecipes([],[first,duplicate,recipe('fake','missing'),{...first,ingredients:[{foodId:'x',grams:100},{foodId:'x',grams:50}]}],[x,y],'gemini-test',now);
 assert.equal(saved.length,1);
 assert.equal(saved[0].version,1);
 assert.equal(saved[0].model,'gemini-test');
 assert.match(saved[0].recipe.id,/^ai-recipe-/);
 assert.equal(saved[0].recipe.ai,true);
 assert.equal(saved[0].recipe.id,saveGeneratedRecipes([],[duplicate],[x,y],'other-model',now)[0].recipe.id);
 assert.deepEqual(saved[0].identities,{x:foodIdentity(x),y:foodIdentity(y)});
 assert.equal(saveGeneratedRecipes(saved,[first],[x,y],'gemini-test',now).length,1);
});

test('offer eligibility and retry dates protect the generation queue',()=>{
 const foods=['fresh','retry','blocked','expired','future','bad-label','excluded'].map(id=>food(id));
 const offers=foods.map(product=>offer(product,product.id==='expired'?{validUntil:now.toISOString()}:product.id==='future'?{validFrom:'2026-10-20T00:00:00Z'}:product.id==='bad-label'?{macros:{...product.macros,protein:NaN}}:{}));
 const attempts=[{foodId:'blocked',checkedAt:now.toISOString(),retryAt:'2026-10-20T00:00:00Z',reason:'Нужна проверка этикетки'},{foodId:'retry',checkedAt:'2026-10-18T00:00:00Z',retryAt:'2026-10-19T00:00:00Z',reason:'HTTP 429'}];
 assert.deepEqual(nextRecipeTargets(foods,offers,[],attempts,2,now).map(product=>product.id),['excluded','fresh']);
 const active=eligibleRecipeFoods(foods,offers,{...input,excludedFoodIds:['excluded']},now);
 assert.deepEqual(active.map(product=>product.id),['fresh','retry','blocked']);
 const summary=recipeCoverage(foods,offers,[],attempts,[recipe('template','fresh')],now);
 assert.equal(summary.coveredFoods,1);assert.equal(summary.needsReview,1);assert.equal(summary.failedFoods,1);assert.equal(summary.pendingFoods,3);
});

test('library rejects malformed cached payloads and invalid clocks',()=>{
 const product=food('x');const saved=saveGeneratedRecipes([],[recipe('valid','x')],[product],'gemini-test',now);
 assert.deepEqual(validSavedRecipes([{...saved[0],identities:{}}],[product],[offer(product)],input,now),[]);
 assert.deepEqual(eligibleRecipeFoods([product],[offer(product)],input,new Date('invalid')),[]);
 assert.deepEqual(saveGeneratedRecipes([],[{...recipe('bad','x'),ingredients:[{foodId:'x',grams:Infinity}]}],[product],'gemini-test',now),[]);
});

test('full template coverage prevents redundant generation and preparation review resets old retries',()=>{
 const x=food('x'),y=food('y');const foods=[x,y],offers=foods.map(product=>offer(product));
 const template={...recipe('plain-template','x'),steps:['Приготовьте продукт по инструкции.']};
 const attempt={foodId:'y',checkedAt:now.toISOString(),retryAt:'2026-11-19T00:00:00Z',reason:'Нужно уточнить приготовление',status:'needs-review' as const,identity:foodIdentity(y)};
 assert.deepEqual(nextRecipeTargets(foods,offers,[],[attempt],8,now,[template]),[]);
 assert.equal(recipeCoverage(foods,offers,[],[attempt],[template],now).needsReview,1);
 const reviewed=[x,{...y,kind:'ready-meat'}];
 assert.deepEqual(nextRecipeTargets(reviewed,offers,[],[attempt],8,now,[template]).map(product=>product.id),['y']);
 assert.equal(recipeCoverage(reviewed,offers,[],[attempt],[template],now).needsReview,0);
 const skipped={...attempt,status:'skipped' as const,reason:'Нет подходящего сочетания'};
 assert.equal(recipeCoverage(foods,offers,[],[skipped],[template],now).failedFoods,0);
});

test('newly saved content is detached from caller mutations and its identity is not rewritten',()=>{
 const product=food('x');const generated=recipe('new','x');
 const saved=saveGeneratedRecipes([],[generated],[product],'gemini-test',now);
 generated.ingredients[0].grams=999;generated.steps[0]='Изменено';
 assert.equal(saved[0].recipe.ingredients[0].grams,100);
 assert.equal(saved[0].recipe.steps[0],'Отмерьте продукт.');
 const captured=saved[0].identities.x;
 const changed={...product,kind:'raw-meat'};
 assert.deepEqual(saveGeneratedRecipes(saved,[],[changed],'gemini-test',now),[]);
 assert.equal(saved[0].identities.x,captured);
});

test('bounded library retains a full 399-product catalogue and never exceeds 1000 entries',()=>{
 const foods=Array.from({length:1005},(_,index)=>food('cap-'+index));
 const saved=saveGeneratedRecipes([],foods.map(product=>recipe(product.id,product.id)),foods,'gemini-test',now);
 assert.equal(saved.length,1000);
 const catalogue=foods.slice(0,399);
 const complete=saveGeneratedRecipes([],catalogue.map(product=>recipe(product.id,product.id)),catalogue,'gemini-test',now);
 assert.equal(recipeCoverage(catalogue,catalogue.map(product=>offer(product)),complete,[],[],now).coveredFoods,399);
});
