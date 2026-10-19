import test from 'node:test';import assert from 'node:assert/strict';
import {reserveRecipeCall,recipeUsageDay} from '../lib/recipe-automation.ts';
test('a provider call is charged before execution, limits survive retry and reset at Kogalym midnight',()=>{
 const first=reserveRecipeCall({dailyLimit:1},new Date('2026-10-19T18:59:59Z'));assert.equal(first.usedCalls,1);assert.throws(()=>reserveRecipeCall(first,new Date('2026-10-19T18:59:59.5Z')),/Лимит/);
 assert.equal(reserveRecipeCall(first,new Date('2026-10-19T19:00:00Z')).usedCalls,1);assert.equal(recipeUsageDay(new Date('2026-10-19T19:00:00Z')),'2026-10-20');assert.throws(()=>reserveRecipeCall({enabled:false}),/приостановлено/);
});
