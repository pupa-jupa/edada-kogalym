import test from 'node:test';import assert from 'node:assert/strict';
import {templateCoverageRecipes} from '../lib/template-coverage.ts';
import {FOODS} from '../lib/catalog.ts';import {getTestOffers} from './fixtures.ts';
test('catalogue coverage reaches supported products beyond the top three brands without inventing generic recipes',()=>{
 const base=FOODS.find(f=>f.id==='pasta')!;const foods=[...FOODS,...Array.from({length:8},(_,i)=>({...base,id:'brand-'+i,name:'Макароны Бренд '+i,kind:'pasta'})),{...base,id:'unknown',name:'Кунжут Бренд',kind:'ingredient'}];
 const fixture=getTestOffers().find(o=>o.foodId==='pasta')!;const offers=[...getTestOffers(),...foods.filter(f=>f.id.startsWith('brand-')||f.id==='unknown').map((f,i)=>({...fixture,id:'offer-'+i,foodId:f.id,price:50+i,demo:false}))];
 const recipes=templateCoverageRecipes(foods,offers);assert.ok(recipes.some(r=>r.ingredients.some(i=>i.foodId==='brand-7')));assert.ok(!recipes.some(r=>r.ingredients.some(i=>i.foodId==='unknown')));
});
