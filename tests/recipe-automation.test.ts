import test from 'node:test';import assert from 'node:assert/strict';
import {reserveRecipeCall,recipeUsageDay,recipeModelForCall} from '../lib/recipe-automation.ts';
test('a provider call is charged before execution, limits survive retry and reset at Kogalym midnight',()=>{
 const first=reserveRecipeCall({dailyLimit:1},new Date('2026-10-19T18:59:59Z'));assert.equal(first.usedCalls,1);assert.throws(()=>reserveRecipeCall(first,new Date('2026-10-19T18:59:59.5Z')),/Лимит/);
 assert.equal(reserveRecipeCall(first,new Date('2026-10-19T19:00:00Z')).usedCalls,1);assert.equal(recipeUsageDay(new Date('2026-10-19T19:00:00Z')),'2026-10-20');assert.throws(()=>reserveRecipeCall({enabled:false}),/приостановлено/);
});
test('provider cooldown uses only the configured light fallback and returns to the preferred model',()=>{
 const current={unavailableModel:'gemini-3.8-flash',modelRetryAt:'2026-10-19T13:00:00Z'},now=new Date('2026-10-19T12:00:00Z');
 assert.equal(recipeModelForCall('gemini-3.8-flash','gemini-3.5-flash-lite',current,now),'gemini-3.5-flash-lite');
 assert.equal(recipeModelForCall('gemini-3.8-flash','gemini-4-pro',current,now),'gemini-3.8-flash');
 assert.equal(recipeModelForCall('gemini-3.8-flash','gemini-3.5-flash-lite',current,new Date('2026-10-19T13:00:00Z')),'gemini-3.8-flash');
});
