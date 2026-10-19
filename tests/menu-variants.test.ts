import test from 'node:test';
import assert from 'node:assert/strict';
import type { Offer, PlanInput, Recipe } from '../lib/domain.ts';
import { optimizeMenuVariants } from '../lib/menu-variants.ts';

const now = new Date('2026-10-19T12:00:00Z');
const input = (patch: Partial<PlanInput> = {}): PlanInput => ({ budget: 100, proteinMin: 20, proteinTolerance: 0, meals: 1, maxMinutes: 20, storeIds: ['a'], excludedFoodIds: [], demo: false, ...patch });
const offer = (patch: Partial<Offer> = {}): Offer => ({ id: 'a-x', foodId: 'x', name: 'Продукт', storeId: 'a', price: 100, packGrams: 500, macros: { kcal: 100, protein: 20, fat: 2, carbs: 3 }, observedAt: '2026-10-18T12:00:00Z', validUntil: '2026-10-25T12:00:00Z', sourceUrl: 'https://example.com', evidence: 'Этикетка', localConfirmed: true, nutritionEstimated: false, status: 'confirmed', demo: false, ...patch });
const recipe = (id: string, foodId = 'x'): Recipe => ({ id, name: id, description: 'Блюдо', emoji: '🍲', minutes: 10, ingredients: [{ foodId, grams: 100 }], steps: ['Приготовить'], tags: [] });
const ids = (result: ReturnType<typeof optimizeMenuVariants>['result']) => result.meals.map(m => m.recipe.id).sort();

test('one requested meal has three selectable recipes, rather than changing the meal count', () => {
  const result = optimizeMenuVariants(input(), [offer()], ['r1', 'r2', 'r3', 'r4'].map(id => recipe(id)), {}, now);
  assert.equal(result.variants.length, 3);
  assert.deepEqual(result.variants.map(ids), [['r1'], ['r2'], ['r3']]);
  assert.deepEqual(result.result, result.variants[0]);
  assert.ok(result.variants.every(v => v.feasible && v.meals.length === 1));
});

test('alternative menus may reuse a recipe while changing its partner', () => {
  const result = optimizeMenuVariants(input({ meals: 2, proteinMin: 40 }), [offer()], ['r1', 'r2', 'r3'].map(id => recipe(id)), {}, now);
  assert.deepEqual(new Set(result.variants.map(v => JSON.stringify(ids(v)))), new Set(['["r1","r2"]', '["r1","r3"]', '["r2","r3"]']));
  assert.ok(result.variants.every(v => v.meals.length === 2 && v.totalCost === 100 && v.shopping[0].packs === 1));
});

test('reroll excludes a whole previous combination while retaining usable individual dishes', () => {
  const result = optimizeMenuVariants(input({ meals: 2, proteinMin: 40 }), [offer()], ['r1', 'r2', 'r3'].map(id => recipe(id)), { excludedRecipeSets: [['r2', 'r1']] }, now);
  assert.equal(result.variants.length, 2);
  assert.ok(result.variants.every(v => JSON.stringify(ids(v)) !== '["r1","r2"]'));
  assert.ok(result.variants.some(v => ids(v).includes('r1')));
  assert.deepEqual(result.result, result.variants[0]);
});

test('disliked dishes and ingredients are excluded without mutating caller preferences', () => {
  const plan = input({ budget: 200, excludedFoodIds: ['z'] });
  const recipes = [recipe('disliked'), recipe('avoided-food', 'y'), recipe('existing-avoid', 'z'), recipe('kept')];
  const options = { excludedRecipeIds: ['disliked'], excludedFoodIds: ['y'] };
  const before = JSON.stringify({ plan, recipes, options });
  const result = optimizeMenuVariants(plan, [offer(), offer({ id: 'y', foodId: 'y' }), offer({ id: 'z', foodId: 'z' })], recipes, options, now);
  assert.deepEqual(result.variants.map(ids), [['kept']]);
  assert.equal(JSON.stringify({ plan, recipes, options }), before);
});

test('exhausted rerolls return an explanation instead of a rejected combination', () => {
  const result = optimizeMenuVariants(input(), [offer()], [recipe('only')], { excludedRecipeSets: [['only']] }, now);
  assert.equal(result.variants.length, 0);
  assert.equal(result.result.feasible, false);
  assert.equal(result.result.status, 'infeasible');
  assert.deepEqual(result.result.meals, []);
  assert.deepEqual(result.result.shopping, []);
  assert.match(result.result.message, /предыдущ|сочетан/i);
});

test('closest protein deficit stays an explicit failure and never becomes an alternative', () => {
  const result = optimizeMenuVariants(input({ proteinMin: 100 }), [offer()], [recipe('low')], {}, now);
  assert.deepEqual(result.variants, []);
  assert.equal(result.result.feasible, false);
  assert.equal(result.result.proteinDeficit, 60);
  assert.equal(result.result.macros.protein, 40);
  assert.deepEqual(ids(result.result), ['low']);
});

test('each alternative uses eligible offers, actual label nutrition and whole-pack budget', () => {
  const recipes = [recipe('x-one'), recipe('x-two'), recipe('lean', 'y'), { ...recipe('too-slow'), minutes: 21 }, recipe('stale', 'stale'), recipe('wrong-store', 'b'), recipe('pending', 'pending'), recipe('demo', 'demo')];
  const offers = [offer({ price: 1, macros: { kcal: 999, protein: 99, fat: 100, carbs: 3 } }), offer({ id: 'lean-x', price: 90, minPacks: 1, macros: { kcal: 100, protein: 30, fat: 1, carbs: 3 } }), offer({ id: 'y', foodId: 'y', price: 40, minPacks: 2, macros: { kcal: 100, protein: 30, fat: 1, carbs: 3 } }), offer({ id: 'stale', foodId: 'stale', validUntil: '2026-10-18T00:00:00Z' }), offer({ id: 'wrong-store', foodId: 'b', storeId: 'b' }), offer({ id: 'pending', foodId: 'pending', status: 'pending' }), offer({ id: 'demo', foodId: 'demo', demo: true })];
  const result = optimizeMenuVariants(input({ fatMax: 2, carbsMax: 6, kcalMax: 200 }), offers, recipes, {}, now);
  assert.equal(result.variants.length, 3);
  assert.deepEqual(new Set(result.variants.flatMap(ids)), new Set(['x-one', 'x-two', 'lean']));
  for (const variant of result.variants) {
    assert.equal(variant.status, 'met');
    assert.ok(variant.totalCost <= 100);
    assert.equal(variant.macros.protein, 30);
    assert.equal(variant.macros.fat, 1);
    assert.equal(variant.macros.kcal, 100);
    assert.equal(variant.shopping.length, 1);
    const item = variant.shopping[0];
    assert.ok(['lean-x', 'y'].includes(item.offer.id));
    assert.equal(item.packs, item.offer.id === 'y' ? 2 : 1);
    assert.equal(item.purchasedGrams, item.packs * 500);
    assert.equal(item.leftoverGrams, item.purchasedGrams - 100);
    assert.equal(item.cost, item.offer.price * item.packs);
  }
});

test('variant count is bounded and results are independent of input arrival order', () => {
  const recipes = Array.from({ length: 15 }, (_, n) => recipe(`r${n.toString().padStart(2, '0')}`));
  const first = optimizeMenuVariants(input(), [offer()], recipes, { limit: 500 }, now);
  assert.equal(first.variants.length, 5);
  assert.deepEqual(first, optimizeMenuVariants(input(), [offer()], [...recipes].reverse(), { limit: 500 }, now));
  assert.ok(first.searched <= 12 * 300_000);
  for (const limit of [NaN, Infinity, 0, -1]) {
    const normalized = optimizeMenuVariants(input(), [offer()], recipes, { limit }, now);
    assert.ok(normalized.variants.length >= 1 && normalized.variants.length <= 5);
  }
});

test('history cannot turn a bounded search into an exhaustive combination scan', () => {
  const recipes = Array.from({ length: 8 }, (_, n) => recipe(`r${n}`));
  const excludedRecipeSets: string[][] = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) for (let c = b + 1; c < 8; c++) excludedRecipeSets.push([`r${a}`, `r${b}`, `r${c}`]);
  const result = optimizeMenuVariants(input({ meals: 3, proteinMin: 60 }), [offer()], recipes, { excludedRecipeSets }, now);
  assert.equal(result.limited, true);
  assert.deepEqual(result.variants, []);
  assert.equal(result.result.feasible, false);
  assert.deepEqual(result.result.meals, []);
  assert.ok(result.searched > 0 && result.searched <= 12 * 300_000);
  assert.match(result.result.warnings.join(' '), /12/);
});

test('a requested suggestion beyond cheap recipes is reserved and used in every alternative', () => {
  const recipes = [...Array.from({ length: 15 }, (_, n) => recipe(`cheap-${n}`)), recipe('suggestion', 'y')];
  const result = optimizeMenuVariants(input({ meals: 2, proteinMin: 40, budget: 200 }), [offer(), offer({ id: 'y', foodId: 'y' })], recipes, { preferredRecipeIds: ['suggestion'] }, now);
  assert.equal(result.variants.length, 3);
  assert.ok(result.variants.every(variant => ids(variant).includes('suggestion')));
});

test('an infeasible requested suggestion never silently applies an unrelated recipe', () => {
  const result = optimizeMenuVariants(input(), [offer(), offer({ id: 'y', foodId: 'y', price: 200 })], [recipe('ordinary'), recipe('suggestion', 'y')], { preferredRecipeIds: ['suggestion'] }, now);
  assert.deepEqual(result.variants, []);
  assert.equal(result.result.feasible, false);
});
