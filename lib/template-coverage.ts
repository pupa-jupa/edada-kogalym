import type {Food,Offer,Recipe} from './domain.ts';
import {DEFAULT_INPUT} from './domain.ts';
import {eligibleRecipeFoods} from './recipe-library.ts';
import {menuRecipes} from './menu-recipes.ts';
/** Enumerate template support independently from the request's twelve-recipe shortlist. */
export function templateCoverageRecipes(foods:Food[],offers:Offer[],now=new Date()):Recipe[]{
 const eligible=eligibleRecipeFoods(foods,offers,undefined,now),roles=new Map<string,string>();
 for(const f of eligible){const kind=f.kind??f.id;if(!roles.has(kind))roles.set(kind,f.id);}
 const partners=[...roles.values(),...eligible.filter(f=>/овся|геркулес|хлопья/i.test(f.name)).slice(0,5).map(f=>f.id)];const recipes=new Map<string,Recipe>();
 for(const food of eligible){
  if(food.kind==='ingredient'||food.kind==='dessert')continue;
  for(const partner of partners){const subset=offers.filter(o=>o.foodId===food.id||o.foodId===partner);const input={...DEFAULT_INPUT,budget:100000,proteinMin:0,maxMinutes:180,meals:1,storeIds:[...new Set(subset.map(o=>o.storeId))]};
   const recipe=menuRecipes(foods,subset,input,now).find(r=>r.ingredients.some(i=>i.foodId===food.id));if(recipe){recipes.set(recipe.id,recipe);break;}
  }
 }return [...recipes.values()];
}
