import {FOODS, RECIPES} from './catalog.ts';
import {DEFAULT_INPUT} from './domain.ts';
import type {Food, Offer, PlanInput, Recipe} from './domain.ts';
import type {CatalogListing} from './proshoper.ts';
import {enrichedFood, enrichmentKey} from './product-enrichment.ts';
import type {EnrichmentRecord} from './product-enrichment.ts';

const STATIC_KINDS:Record<string,string>={
 chicken:'raw-fillet',turkey:'raw-fillet',pollock:'raw-fillet',tuna:'raw-fillet',
 cottage:'curd','cottage-fatfree':'curd','cottage-grained':'curd',buckwheat:'grain',rice:'grain',oats:'grain',lentils:'grain',pasta:'pasta',
 potato:'vegetable',carrot:'vegetable',onion:'vegetable',cabbage:'vegetable',tomato:'vegetable',cucumber:'vegetable',apple:'fruit',
};

/** Build one registry for validation, UI and recipe generation. No estimated label is created here. */
export function allFoods(records:EnrichmentRecord[],listings:CatalogListing[]):Food[]{
 const result=new Map<string,Food>(FOODS.map(f=>[f.id,{...f,kind:f.kind??STATIC_KINDS[f.id]}]));
 const matched=new Map<string,EnrichmentRecord>();
 for(const record of records){
  if(record.status!=='matched'||!record.candidate)continue;
  const previous=matched.get(record.key);
  if(!previous||Date.parse(record.checkedAt)>Date.parse(previous.checkedAt))matched.set(record.key,record);
 }
 for(const row of listings){
  const record=matched.get(enrichmentKey(row));
  if(!record?.candidate)continue;
  const food=enrichedFood(row,record.candidate);
  if(food&&!result.has(food.id))result.set(food.id,food);
 }
 return [...result.values()];
}

type Ranked={recipe:Recipe;family:string;score:number;curd:boolean};
const finiteMacros=(o:Offer)=>!!o.macros&&[o.macros.kcal,o.macros.protein,o.macros.fat,o.macros.carbs].every(n=>Number.isFinite(n)&&n>=0);
function eligible(o:Offer,input:PlanInput,now:number):boolean{
 return o.status==='confirmed'&&o.localConfirmed===true&&o.demo===input.demo&&input.storeIds.includes(o.storeId)&&!input.excludedFoodIds.includes(o.foodId)
  &&Number.isFinite(o.price)&&o.price>0&&Number.isFinite(o.packGrams)&&o.packGrams>0&&finiteMacros(o)
  &&(o.minPacks===undefined||(Number.isInteger(o.minPacks)&&o.minPacks>=1&&o.minPacks<=100))
  &&(!o.validFrom||(Number.isFinite(Date.parse(o.validFrom))&&Date.parse(o.validFrom)<=now))
  &&Number.isFinite(Date.parse(o.observedAt))&&Date.parse(o.observedAt)<=now&&Date.parse(o.validUntil)>now;
}
function rawStep(food:Food):string{
 const fish=food.kind==='raw-seafood'||food.allergens.includes('Рыба')||/рыб|минта|тун[её]ц|треск|хек|лосос|форел|пангасиус|тилап|кревет|кальмар/i.test(food.name);
 // All minced meat and meat cuts use the conservative 74 C endpoint; fish fillets/seafood 63 C.
 const temperature=food.kind==='raw-meat'?74:fish?63:74;
 return `Заранее разморозьте продукт в холодильнике, если он заморожен. Нарежьте ${food.name}, положите в сотейник со 100 мл воды на порцию. Готовьте под крышкой, при необходимости подливая воду, до ${temperature} °C в центре самого толстого кусочка. Время зависит от размера; проверьте температуру термометром.`;
}
const cooked=(food:Food)=>food.kind==='pasta'
 ?`Взвесьте ${food.name} в сухом виде. Отварите в воде по инструкции на упаковке до готовности, слейте воду.`
 :`Взвесьте ${food.name} в сухом виде. Отварите в воде до полной готовности по инструкции на упаковке, при необходимости подливая воду.`;

/** Pure, bounded recipe pool. Price and nutrients always come from eligible local offers. */
export function menuRecipes(foods:Food[],offers:Offer[],input?:PlanInput,now=new Date()):Recipe[]{
 const plan=input??{...DEFAULT_INPUT,storeIds:[...new Set(offers.map(o=>o.storeId))]};
 if(!Number.isFinite(now.getTime()))return [];
 const registry=new Map(foods.map(f=>[f.id,{...f,kind:f.kind??STATIC_KINDS[f.id]}]));
 const byFood=new Map<string,Offer>();
 // One representative offer for ranking only; optimizer still receives every eligible package.
 for(const o of offers){
  if(!registry.has(o.foodId)||!eligible(o,plan,now.getTime()))continue;
  const prev=byFood.get(o.foodId);
  const rank=(v:Offer)=>v.price/v.packGrams+v.price*(v.minPacks??1)/Math.max(plan.budget,1)/100;
  if(!prev||rank(o)<rank(prev)||(rank(o)===rank(prev)&&o.id.localeCompare(prev.id)<0))byFood.set(o.foodId,o);
 }
 const roles=new Map<string,Food[]>();
 for(const id of byFood.keys()){
  const food=registry.get(id)!;
  if(!food.kind)continue;
  const list=roles.get(food.kind)??[];list.push(food);roles.set(food.kind,list);
 }
 const proteinTarget=plan.proteinMin/Math.max(plan.meals,1);
 const foodScore=(f:Food)=>{
  const o=byFood.get(f.id)!;
  return o.price/o.packGrams*100/Math.max(plan.budget/Math.max(plan.meals,1),1)
   -Math.min(o.macros.protein,Math.max(proteinTarget,10))/20
   +(plan.fatMax===undefined?0:o.macros.fat/Math.max(plan.fatMax,1))
   +(plan.carbsMax===undefined?0:o.macros.carbs/Math.max(plan.carbsMax,1));
 };
 for(const [kind,list] of roles){
  const sorted=list.sort((a,b)=>foodScore(a)-foodScore(b)||a.id.localeCompare(b.id));
  if(kind!=='grain'){roles.set(kind,sorted.slice(0,3));continue;}
  // Preserve distinct cooking roles before taking additional brands of the same grain.
  const group=(f:Food)=>f.id==='oats'||/овся|геркулес|хлопья/i.test(f.name)?'oats'
   :f.id==='rice'||/рис/i.test(f.name)?'rice':f.id==='buckwheat'||/греч/i.test(f.name)?'buckwheat':'other';
  const selected:Food[]=[],seen=new Set<string>();
  for(const f of sorted)if(!seen.has(group(f))&&selected.length<3){selected.push(f);seen.add(group(f));}
  for(const f of sorted)if(selected.length<3&&!selected.includes(f))selected.push(f);
  roles.set(kind,selected);
 }
 const role=(...kinds:string[])=>kinds.flatMap(k=>roles.get(k)??[]);
 const ranked:Ranked[]=[];
 const compositions=new Set<string>();
 const add=(recipe:Recipe,family:string,builtin=false)=>{
  if(recipe.minutes>plan.maxMinutes||!Number.isFinite(recipe.minutes)||recipe.ingredients.length===0||!recipe.ingredients.every(i=>registry.has(i.foodId)&&byFood.has(i.foodId)&&i.grams>0&&Number.isFinite(i.grams)))return;
  const totalGrams=recipe.ingredients.reduce((n,i)=>n+i.grams,0);
  const composition=recipe.ingredients.map(i=>i.foodId+':'+(i.grams/totalGrams).toFixed(6)).sort().join('|');
  if(compositions.has(composition))return;compositions.add(composition);
  let cost=0,protein=0,fat=0,carbs=0,kcal=0;
  for(const i of recipe.ingredients){
   const o=byFood.get(i.foodId)!;
   // Half is the optimizer's smallest portion; all package minimums are included.
   cost+=Math.max(Math.ceil(i.grams*.5/o.packGrams),o.minPacks??1)*o.price;
   protein+=o.macros.protein*i.grams/100;fat+=o.macros.fat*i.grams/100;carbs+=o.macros.carbs*i.grams/100;kcal+=o.macros.kcal*i.grams/100;
  }
  const capPenalty=(n:number,cap:number|undefined)=>cap===undefined?0:n/Math.max(cap/Math.max(plan.meals,1),1);
  const deficit=Math.max(0,proteinTarget-protein)/Math.max(proteinTarget,1);
  const score=cost/Math.max(plan.budget,1)+deficit*3+capPenalty(fat,plan.fatMax)+capPenalty(carbs,plan.carbsMax)+capPenalty(kcal,plan.kcalMax)
   +(cost>plan.budget?10:0)-(builtin?.05:0);
  ranked.push({recipe,family,score,curd:recipe.ingredients.some(i=>registry.get(i.foodId)?.kind==='curd')});
 };
 for(const recipe of RECIPES){
  const family=recipe.ingredients.map(i=>registry.get(i.foodId)?.kind??i.foodId).sort().join('+');
  add(recipe,family,true);
 }
 const make=(family:string,ingredients:Array<[Food,number]>,name:string,minutes:number,steps:string[],emoji='🍲')=>{
  const id='cook-'+family+'-'+ingredients.map(([f])=>f.id).join('-');
  add({id,name,description:'Граммы указаны для продукта до приготовления. Вода — единственный дополнительный ингредиент.',emoji,minutes,ingredients:ingredients.map(([f,grams])=>({foodId:f.id,grams})),steps,tags:['Из доступных продуктов','Без масла']},family);
 };
 const sides=role('grain','pasta');
 for(const side of sides){
  // A plain cooked staple remains usable when no protein pairing is available.
  make('plain-'+side.kind,[[side,70]],side.name+' на воде',25,[cooked(side)]);
  for(const main of role('canned-fish','canned-beans','ready-meat','raw-fillet','raw-meat','raw-seafood')){
   const raw=main.kind?.startsWith('raw-');
   const grams=raw?180:main.kind==='canned-beans'?150:120;
   const mainStep=raw?rawStep(main):main.kind==='ready-meat'
    ?`Приготовьте или разогрейте ${main.name} по инструкции на упаковке; при необходимости добавляйте только воду.`
    :`Отмерьте ${main.name} в виде, для которого указаны КБЖУ. Не сливайте заливку, если пищевая ценность дана для содержимого вместе с ней. Прогрейте с готовым гарниром.`;
   make(side.kind+'-'+main.kind,[[side,70],[main,grams]],side.name+' с '+main.name,raw?35:25,[cooked(side),mainStep,'Соедините готовые продукты и подавайте.']);
  }
  for(const veg of role('vegetable')){
   make(side.kind+'-vegetable',[[side,70],[veg,150]],side.name+' с овощами',30,[cooked(side),`Вымойте и подготовьте съедобную часть ${veg.name}. Нарежьте и отварите в воде до полной мягкости. Соедините с готовым гарниром.`]);
  }
 }
 for(const curd of role('curd','yogurt')){
  for(const fruit of role('fruit')){
   make(curd.kind+'-fruit',[[curd,180],[fruit,120]],curd.name+' с '+fruit.name,5,[`Вымойте ${fruit.name}, подготовьте и взвесьте съедобную часть, нарежьте. Смешайте с ${curd.name}.`],'🥣');
   for(const nuts of role('nuts').slice(0,1))make(curd.kind+'-fruit-nuts',[[curd,180],[fruit,100],[nuts,15]],curd.name+' с фруктами и орехами',5,[`Вымойте ${fruit.name}, подготовьте и взвесьте съедобную часть. Измельчите ${nuts.name}, смешайте все ингредиенты.`],'🥣');
  }
  for(const side of role('grain').filter(f=>f.id==='oats'||/овся|геркулес|хлопья/i.test(f.name))){
   make(curd.kind+'-oats',[[side,50],[curd,180]],side.name+' с '+curd.name,20,[cooked(side),`Снимите кашу с огня, немного остудите и добавьте ${curd.name}.`],'🥣');
  }
 }
 for(const bread of role('bread'))for(const cheese of role('cheese')){
  make('bread-cheese',[[bread,70],[cheese,40]],bread.name+' с '+cheese.name,5,[`Отмерьте ${bread.name}, нарежьте ${cheese.name} и выложите на хлеб.`],'🥪');
 }
 for(const raw of role('raw-fillet','raw-meat','raw-seafood')){
  for(const veg of role('vegetable').slice(0,1))make(raw.kind+'-vegetable',[[raw,180],[veg,150]],raw.name+' с овощами',35,[rawStep(raw),`Вымойте и подготовьте съедобную часть ${veg.name}. Нарежьте, отварите в воде до полной мягкости и подавайте с приготовленным основным продуктом.`]);
 }
 const sorted=ranked.sort((a,b)=>a.score-b.score||a.recipe.id.localeCompare(b.recipe.id));
 const chosen:Ranked[]=[],families=new Map<string,number>(),ids=new Set<string>();
 let curdCount=0;
 const take=(candidate:Ranked,limit:number)=>{
  if(ids.has(candidate.recipe.id)||(families.get(candidate.family)??0)>=limit||(candidate.curd&&curdCount>=4))return;
  chosen.push(candidate);ids.add(candidate.recipe.id);families.set(candidate.family,(families.get(candidate.family)??0)+1);if(candidate.curd)curdCount++;
 };
 // Reserve breadth before filling variants: thirty curds cannot consume all twelve slots.
 for(const candidate of sorted){take(candidate,1);if(chosen.length===12)break;}
 if(chosen.length<12)for(const candidate of sorted){take(candidate,2);if(chosen.length===12)break;}
 return chosen.map(c=>c.recipe);
}

