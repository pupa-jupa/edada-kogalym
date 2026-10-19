import type {Food,Offer,PlanInput,Recipe} from './domain.ts';

export type SavedRecipe={recipe:Recipe;model:string;createdAt:string;identities:Record<string,string>;version:1};
export type GenerationAttempt={foodId:string;checkedAt:string;retryAt:string;reason:string;status?:'needs-review'|'error'|'skipped';identity?:string};
/** An owner-requested retry corrects recipe output without retrying a throttled provider. */
export function immediateRecipeRetries(attempts:GenerationAttempt[],now=new Date()):GenerationAttempt[]{
 return attempts.map(a=>a.status==='error'&&!/^Gemini: HTTP|превышен|лимит|квота|aborted|timeout/i.test(a.reason)?{...a,retryAt:now.toISOString()}:a);
}

// Two independent 32-bit accumulators keep identifiers synchronous and portable.
function fingerprint(value:string):string{
 let first=2166136261,second=5381;
 for(let index=0;index<value.length;index++){
  const code=value.charCodeAt(index);first=Math.imul(first^code,16777619);second=Math.imul(second,33)^code;
 }
 return (first>>>0).toString(16).padStart(8,'0')+(second>>>0).toString(16).padStart(8,'0');
}
const normalized=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');

/** Price and nutrition updates recalculate a menu without invalidating preparation. */
export function foodIdentity(food:Food):string{
 const facts:unknown[]=[normalized(food.name),food.kind??'',food.allergens.map(normalized).sort()];
 if(food.preparation)facts.push([food.preparation.kind,food.preparation.sourceUrl,normalized(food.preparation.evidence),food.preparation.useWholeContents===true]);
 return fingerprint(JSON.stringify(facts));
}

/** Every edible registry category is eligible; preparation roles are not an allowlist. */
export function eligibleRecipeOffers(offers:Offer[],input?:PlanInput,now=new Date()):Offer[]{
 const time=now.getTime();if(!Number.isFinite(time))return [];
 return offers.filter(offer=>offer.status==='confirmed'&&offer.localConfirmed===true&&offer.demo===(input?.demo??false)
  &&(!input||(input.storeIds.includes(offer.storeId)&&!input.excludedFoodIds.includes(offer.foodId)))
  &&Number.isFinite(offer.price)&&offer.price>0&&Number.isFinite(offer.packGrams)&&offer.packGrams>0
  &&offer.macros&&[offer.macros.kcal,offer.macros.protein,offer.macros.fat,offer.macros.carbs].every(value=>Number.isFinite(value)&&value>=0)
  &&(offer.minPacks===undefined||(Number.isInteger(offer.minPacks)&&offer.minPacks>=1&&offer.minPacks<=100))
  &&(!offer.validFrom||(Number.isFinite(Date.parse(offer.validFrom))&&Date.parse(offer.validFrom)<=time))
  &&Number.isFinite(Date.parse(offer.observedAt))&&Date.parse(offer.observedAt)<=time&&Date.parse(offer.validUntil)>time);
}
export function eligibleRecipeFoods(foods:Food[],offers:Offer[],input?:PlanInput,now=new Date()):Food[]{
 const ids=new Set(eligibleRecipeOffers(offers,input,now).map(offer=>offer.foodId));
 const seen=new Set<string>();return foods.filter(food=>{if(food.kind==='not-for-recipes'||!ids.has(food.id)||seen.has(food.id))return false;seen.add(food.id);return true;});
}

function validRecipe(recipe:Recipe,foodIds:Set<string>,minimumSteps=2):boolean{
 if(!recipe||typeof recipe.id!=='string'||!recipe.id||typeof recipe.name!=='string'||!recipe.name.trim()||recipe.name.length>160
  ||typeof recipe.description!=='string'||recipe.description.length>400||typeof recipe.emoji!=='string'||recipe.emoji.length>10
  ||!Number.isInteger(recipe.minutes)||recipe.minutes<3||recipe.minutes>180||!Array.isArray(recipe.ingredients)||recipe.ingredients.length<1||recipe.ingredients.length>10
  ||!Array.isArray(recipe.steps)||recipe.steps.length<minimumSteps||recipe.steps.length>10||!recipe.steps.every(step=>typeof step==='string'&&step.trim().length>0&&step.length<=1000)
  ||!Array.isArray(recipe.tags)||recipe.tags.length>6||!recipe.tags.every(tag=>typeof tag==='string'&&tag.length<=40))return false;
 const ids=new Set<string>();
 return recipe.ingredients.every(ingredient=>{
  if(!ingredient||!foodIds.has(ingredient.foodId)||ids.has(ingredient.foodId)||!Number.isFinite(ingredient.grams)||ingredient.grams<1||ingredient.grams>1500)return false;
  ids.add(ingredient.foodId);return true;
 });
}
function matchingEntry(entry:SavedRecipe,registry:Map<string,Food>,now:Date):boolean{
 return !!entry&&entry.version===1&&typeof entry.model==='string'&&Number.isFinite(Date.parse(entry.createdAt))&&Date.parse(entry.createdAt)<=now.getTime()
  &&validRecipe(entry.recipe,new Set(registry.keys()))&&!!entry.identities&&entry.recipe.ingredients.every(ingredient=>entry.identities[ingredient.foodId]===foodIdentity(registry.get(ingredient.foodId)!));
}
function availableRecipes(recipes:Recipe[],foods:Food[],input?:PlanInput,minimumSteps=2):Recipe[]{
 const ids=new Set(foods.map(food=>food.id));
 return recipes.filter(recipe=>validRecipe(recipe,ids,minimumSteps)&&(!input||recipe.minutes<=input.maxMinutes));
}

/** Expired prices filter a recipe at read time; the persisted entry is retained. */
export function validSavedRecipes(entries:SavedRecipe[],foods:Food[],offers:Offer[],input?:PlanInput,now=new Date()):Recipe[]{
 const registry=new Map(foods.map(food=>[food.id,food]));
 const matching=entries.filter(entry=>matchingEntry(entry,registry,now));
 const seen=new Set<string>();
 return availableRecipes(matching.map(entry=>entry.recipe),eligibleRecipeFoods(foods,offers,input,now),input).filter(recipe=>{
  if(seen.has(recipe.id))return false;seen.add(recipe.id);return true;
 });
}

function composition(recipe:Recipe):string{
 const total=recipe.ingredients.reduce((sum,ingredient)=>sum+ingredient.grams,0);
 return JSON.stringify(recipe.ingredients.map(ingredient=>[ingredient.foodId,(ingredient.grams/total).toFixed(8)]).sort((left,right)=>String(left[0]).localeCompare(String(right[0]))));
}

/** Invalid siblings are ignored; generated IDs never enter the persistent namespace. */
export function saveGeneratedRecipes(existing:SavedRecipe[],recipes:Recipe[],foods:Food[],model:string,now=new Date()):SavedRecipe[]{
 if(!Number.isFinite(now.getTime()))return existing.slice(0,1000);
 const registry=new Map(foods.map(food=>[food.id,food]));const ids=new Set(registry.keys());const saved=new Map<string,SavedRecipe>();
 for(const entry of existing)if(matchingEntry(entry,registry,now))saved.set(composition(entry.recipe),entry);
 for(const recipe of recipes){
  if(!validRecipe(recipe,ids))continue;
  const key=composition(recipe);if(saved.has(key))continue;
  const identities:Record<string,string>={};for(const ingredient of recipe.ingredients)identities[ingredient.foodId]=foodIdentity(registry.get(ingredient.foodId)!);
  const copy:Recipe={...recipe,id:'ai-recipe-'+fingerprint(key),ai:true,ingredients:recipe.ingredients.map(ingredient=>({...ingredient})),steps:[...recipe.steps],tags:[...recipe.tags]};
  saved.set(key,{recipe:copy,model,createdAt:now.toISOString(),identities,version:1});
 }
 return [...saved.values()].sort((left,right)=>Date.parse(right.createdAt)-Date.parse(left.createdAt)||left.recipe.id.localeCompare(right.recipe.id)).slice(0,1000);
}
function latestAttempts(attempts:GenerationAttempt[]):Map<string,GenerationAttempt>{
 const latest=new Map<string,GenerationAttempt>();
 for(const attempt of attempts){
  if(!Number.isFinite(Date.parse(attempt.checkedAt)))continue;
  const previous=latest.get(attempt.foodId);
  if(!previous||Date.parse(attempt.checkedAt)>Date.parse(previous.checkedAt))latest.set(attempt.foodId,attempt);
 }
 return latest;
}
export function nextRecipeTargets(foods:Food[],offers:Offer[],entries:SavedRecipe[],attempts:GenerationAttempt[],limit=8,now=new Date(),templates:Recipe[]=[]):Food[]{
 if(!Number.isFinite(limit)||limit<=0)return [];
 const eligible=eligibleRecipeFoods(foods,offers,undefined,now);
 const covered=new Set([...validSavedRecipes(entries,foods,offers,undefined,now),...availableRecipes(templates,eligible,undefined,1)].flatMap(recipe=>recipe.ingredients.map(ingredient=>ingredient.foodId)));
 const latest=latestAttempts(attempts);
 return eligible.filter(food=>{const attempt=latest.get(food.id);return !covered.has(food.id)&&!(attempt&&(!attempt.identity||attempt.identity===foodIdentity(food))&&Date.parse(attempt.retryAt)>now.getTime());})
  .sort((left,right)=>(Date.parse(latest.get(left.id)?.checkedAt??'')||0)-(Date.parse(latest.get(right.id)?.checkedAt??'')||0)||left.id.localeCompare(right.id)).slice(0,Math.floor(limit));
}
export function recipeCoverage(foods:Food[],offers:Offer[],entries:SavedRecipe[],attempts:GenerationAttempt[],templates:Recipe[]=[],now=new Date()){
 const eligible=eligibleRecipeFoods(foods,offers,undefined,now);const generated=validSavedRecipes(entries,foods,offers,undefined,now);
 const supported=[...generated,...availableRecipes(templates,eligible,undefined,1)];const covered=new Set(supported.flatMap(recipe=>recipe.ingredients.map(ingredient=>ingredient.foodId)));
 const pending=eligible.filter(food=>!covered.has(food.id));const latest=latestAttempts(attempts);let needsReview=0,failedFoods=0;
 for(const food of pending){const attempt=latest.get(food.id);if(!attempt||(attempt.identity&&attempt.identity!==foodIdentity(food)))continue;if(attempt.status==='needs-review'||(!attempt.status&&/review|verif|уточн|провер|неизвест|этикет/i.test(attempt.reason)))needsReview++;else if(attempt.status!=='skipped')failedFoods++;}
 return {eligibleFoods:eligible.length,coveredFoods:eligible.length-pending.length,generatedRecipes:generated.length,pendingFoods:pending.length,needsReview,failedFoods};
}
