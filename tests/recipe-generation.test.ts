import test from 'node:test';
import assert from 'node:assert/strict';
import {recipePreparationIssue,validateGeneratedBatch,generationSchema} from '../lib/recipe-generation.ts';
import type {Food} from '../lib/domain.ts';
const foods:Food[]=[{id:'sesame',name:'Кунжут Айдиго',kind:'ingredient',category:'Семена',emoji:'🌱',allergens:[],macros:{kcal:570,protein:19,fat:49,carbs:12}},{id:'oats',name:'Хлопья овсяные',kind:'grain',category:'Крупы',emoji:'🌾',allergens:[],macros:{kcal:350,protein:13,fat:6,carbs:60}}];
const recipe={name:'Каша с кунжутом',description:'Каша на воде',emoji:'🥣',minutes:15,ingredients:[{foodId:'sesame',grams:10},{foodId:'oats',grams:60}],steps:[{text:'Отварите хлопья в воде.',foodIds:['oats'],waterMl:200},{text:'Добавьте кунжут и перемешайте.',foodIds:['sesame'],waterMl:0}],tags:['Завтрак']};
test('large catalogues retain a compact provider grammar and enforce identities on the server',()=>{
 const all=[...foods,...Array.from({length:150},(_,index)=>({...foods[0],id:'e-product-'+String(index).padStart(24,'0')}))];
 assert.ok(JSON.stringify(generationSchema(all.map(f=>f.id))).length<3000);
 const invalid={...recipe,ingredients:[...recipe.ingredients,{foodId:'outside-catalog',grams:10}]};
 const result=validateGeneratedBatch({recipes:[recipe,invalid],unusableTargets:[]},all,['sesame']);
 assert.equal(result.recipes.length,1);assert.equal(result.rejected,1);
});

test('complete structured recipes use target foods without model nutrition or prices',()=>{
 const result=validateGeneratedBatch({recipes:[{...recipe,price:1,macros:{protein:999}}],unusableTargets:[]},foods,['sesame']);assert.equal(result.recipes.length,1);assert.equal(result.recipes[0].ai,true);assert.equal('price' in result.recipes[0],false);assert.equal('macros' in result.recipes[0],false);
});
test('invalid siblings, phantom ingredients and recipes without a target cannot claim coverage',()=>{
 const invalid=[{...recipe,ingredients:[{foodId:'invented',grams:10}]},{...recipe,steps:[{text:'Добавьте масло.',foodIds:['sesame'],waterMl:0},{text:'Смешайте.',foodIds:['oats'],waterMl:0}]},{...recipe,ingredients:[{foodId:'oats',grams:60}]}];
 const result=validateGeneratedBatch({recipes:[...invalid,recipe],unusableTargets:[{foodId:'invented',reason:'irrelevant'}]},foods,['sesame']);assert.equal(result.recipes.length,1);assert.equal(result.rejected,3);assert.equal(result.unusableTargets.length,0);
});

const rawFood=(id:string,kind:string,name:string):Food=>({...foods[0],id,kind,name,allergens:[]});
const rawRecipe=(id:string,text:string)=>({...recipe,name:'Приготовленный продукт',ingredients:[{foodId:id,grams:150}],steps:[{text,foodIds:[id],waterMl:100},{text:'Переложите готовый продукт в тарелку.',foodIds:[id],waterMl:0}]});

test('raw roles require an actual cooking endpoint on a step referencing that ingredient',()=>{
 for(const [kind,name,temperature] of [['raw-fillet','Филе куриное',74],['raw-meat','Фарш говяжий',74],['raw-fillet','Филе минтая',63],['raw-seafood','Креветки очищенные сырые',63]] as const){
  const product=rawFood('raw',kind,name);
  const accepted=rawRecipe('raw',`Готовьте под крышкой до ${temperature} °C в центре самого толстого кусочка, проверьте термометром.`);
  assert.equal(validateGeneratedBatch({recipes:[accepted],unusableTargets:[]},[product],['raw']).recipes.length,1,name);
  const absent=rawRecipe('raw','Готовьте пять минут и подавайте.');
  const tooLow=rawRecipe('raw',`Готовьте до ${temperature-1} °C в центре.`);
  const notCooking=rawRecipe('raw',`Температура в комнате ${temperature} °C. Нарежьте продукт.`);
  for(const rejected of [absent,tooLow,notCooking])assert.equal(validateGeneratedBatch({recipes:[rejected],unusableTargets:[]},[product],['raw']).recipes.length,0,name);
 }
 const chicken=rawFood('chicken','raw-meat','Филе куриное');
 const mismatch={...rawRecipe('chicken','Нарежьте курицу.'),ingredients:[{foodId:'chicken',grams:150},{foodId:'oats',grams:50}],steps:[{text:'Нарежьте курицу.',foodIds:['chicken'],waterMl:0},{text:'Готовьте до 74 °C в центре.',foodIds:['oats'],waterMl:200}]};
 assert.equal(validateGeneratedBatch({recipes:[mismatch],unusableTargets:[]},[chicken,foods[1]],['chicken']).recipes.length,0);
});

test('explicit raw serving and instructions negating cooking are rejected even with a temperature',()=>{
 const product=rawFood('chicken','raw-meat','Филе куриное');
 for(const unsafe of ['Подавайте сырое филе сразу.','Ешьте курицу в сыром виде.','Не готовьте до 74 °C в центре.','Не доведите до 74 °C в центре.','Serve the chicken raw.']){
  const candidate={...rawRecipe('chicken','Готовьте до 74 °C в центре.'),steps:[{text:'Готовьте до 74 °C в центре.',foodIds:['chicken'],waterMl:100},{text:unsafe,foodIds:['chicken'],waterMl:0}]};
  assert.equal(validateGeneratedBatch({recipes:[candidate],unusableTargets:[]},[product],['chicken']).recipes.length,0,unsafe);
 }
});

test('obvious undeclared additions cannot hide behind correct structured references',()=>{
 for(const extra of ['сметану','сыр','соус','специи','лимонный сок','чеснок','муку','яйцо','майонез','сливки','оливковое масло','соль']){
  const candidate={...recipe,steps:[recipe.steps[0],{text:`Добавьте кунжут и ${extra}.`,foodIds:['sesame'],waterMl:0}]};
  assert.equal(validateGeneratedBatch({recipes:[candidate],unusableTargets:[]},foods,['sesame']).recipes.length,0,extra);
 }
 // A word in a flavoured product name is not an available standalone ingredient.
 const chocolate={...foods[0],id:'chocolate',name:'Шоколад молочный с орехами',kind:'dessert'};
 const inventedMilk=rawRecipe('chocolate','Добавьте молоко и перемешайте.');
 assert.equal(validateGeneratedBatch({recipes:[inventedMilk],unusableTargets:[]},[chocolate],['chocolate']).recipes.length,0);
});

test('declared additions remain allowed and negative pantry statements add no ingredients',()=>{
 const cheese=rawFood('cheese','cheese','Сыр Российский');
 const withCheese={...recipe,ingredients:[...recipe.ingredients,{foodId:'cheese',grams:20}],steps:[recipe.steps[0],{text:'Добавьте кунжут и сыр. Масло и соль не добавляйте.',foodIds:['sesame','cheese'],waterMl:0}]};
 assert.equal(validateGeneratedBatch({recipes:[withCheese],unusableTargets:[]},[...foods,cheese],['sesame']).recipes.length,1);
 const without=rawRecipe('oats','Отварите хлопья в воде без масла и соли.');
 assert.equal(validateGeneratedBatch({recipes:[without],unusableTargets:[]},foods,['oats']).recipes.length,1);
 const salt=rawFood('salt','ingredient','Соль поваренная');
 const salted={...recipe,ingredients:[...recipe.ingredients,{foodId:'salt',grams:1}],steps:[recipe.steps[0],{text:'Приправьте солью, добавьте кунжут. Используйте специальную ложку.',foodIds:['sesame','salt'],waterMl:0}]};
 assert.equal(validateGeneratedBatch({recipes:[salted],unusableTargets:[]},[...foods,salt],['sesame']).recipes.length,1);
});

test('unclassified animal products become explicit review targets instead of raw serving recipes',()=>{
 for(const name of ['Стейк говяжий Мираторг 300г','Филе говядины 300г','Креветки сырые 500г','Рыба дорадо 500г']){
  const product=rawFood('unknown','ingredient',name);
  const unsafe=rawRecipe('unknown','Нарежьте продукт и подавайте сырое мясо сразу.');
  const result=validateGeneratedBatch({recipes:[unsafe],unusableTargets:[]},[product],['unknown']);
  assert.equal(result.recipes.length,0,name);assert.equal(result.rejected,1);
  assert.equal(result.unusableTargets.length,1);assert.equal(result.unusableTargets[0].foodId,'unknown');
  assert.match(result.unusableTargets[0].reason,/роль|съедобн|готов/i);
  assert.equal(result.unusableTargets[0].reason,recipePreparationIssue(product));
 }
 const unknown=rawFood('steak','ingredient','Стейк говяжий Мираторг');
 const skipped=validateGeneratedBatch({recipes:[],unusableTargets:[]},[unknown],['steak']);
 assert.equal(skipped.unusableTargets.length,1);
});

test('reviewed animal roles use endpoint checks while unrelated ingredients stay eligible',()=>{
 const reviewed=rawFood('steak','raw-meat','Стейк говяжий Мираторг');
 assert.equal(recipePreparationIssue(reviewed),undefined);
 assert.equal(validateGeneratedBatch({recipes:[rawRecipe('steak','Готовьте до 74 °C в центре, проверьте термометром.')],unusableTargets:[]},[reviewed],['steak']).recipes.length,1);
 for(const product of [foods[0],foods[1],rawFood('plant','ingredient','Стейк из цветной капусты')]){
  assert.equal(recipePreparationIssue(product),undefined,product.name);
 }
});
