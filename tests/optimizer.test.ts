import test from 'node:test';
import assert from 'node:assert/strict';
import type { Macros, Offer, PlanInput, Recipe } from '../lib/domain.ts';
import { optimizeMenu } from '../lib/optimizer.ts';
import { FOODS, RECIPES, STORES, getDemoOffers } from '../lib/catalog.ts';

const now = new Date('2026-10-19T12:00:00Z');
const macros: Macros = { kcal: 100, protein: 20, fat: 2, carbs: 3 };
const input = (patch: Partial<PlanInput> = {}): PlanInput => ({ budget: 100, proteinMin: 20, proteinTolerance: 0, meals: 1, maxMinutes: 40, storeIds: ['a'], excludedFoodIds: [], demo: false, ...patch });
const offer = (patch: Partial<Offer> = {}): Offer => ({ id: 'a-x', foodId: 'x', name: 'Продукт', storeId: 'a', price: 100, packGrams: 500, macros, observedAt: '2026-10-18T12:00:00Z', validUntil: '2026-10-25T12:00:00Z', sourceUrl: 'https://example.com', evidence: 'Этикетка', localConfirmed: true, nutritionEstimated: false, status: 'confirmed', demo: false, ...patch });
const recipe = (id = 'r1', grams = 100, foodId = 'x'): Recipe => ({ id, name: id, description: 'Тестовое блюдо', emoji: '🍲', minutes: 10, ingredients: [{ foodId, grams }], steps: ['Приготовить'], tags: [] });

test('shares whole packages between distinct meals and separates checkout from consumed cost', () => {
  const r = optimizeMenu(input({ meals: 2, proteinMin: 60 }), [offer()], [recipe('r1'), recipe('r2')], now);
  assert.equal(r.status, 'met');
  assert.equal(r.meals.length, 2);
  assert.equal(new Set(r.meals.map(m => m.recipe.id)).size, 2);
  assert.equal(r.shopping.length, 1);
  assert.equal(r.shopping[0].packs, 1);
  assert.equal(r.totalCost, 100);
  assert.equal(r.shopping[0].purchasedGrams, 500);
  assert.equal(r.shopping[0].leftoverGrams, 500 - r.shopping[0].usedGrams);
  assert.equal(r.consumedCost, r.shopping[0].usedGrams / 5);
  assert.equal(r.meals.reduce((s, m) => s + m.ingredientCost, 0), r.consumedCost);
});

test('cannot buy a fraction of an unaffordable package', () => {
  const r = optimizeMenu(input({ budget: 30 }), [offer()], [recipe()], now);
  assert.equal(r.feasible, false);
  assert.equal(r.status, 'infeasible');
  assert.ok(r.totalCost <= 30);
  assert.ok(r.proteinDeficit > 0);
});

test('minimum package condition cannot make a 200-ruble purchase fit a 150-ruble budget', () => {
  const r = optimizeMenu(input({ budget: 150, proteinMin: 40 }), [offer({ minPacks: 2, priceCondition: 'Только от 2 упаковок' })], [recipe()], now);
  assert.equal(r.feasible, false);
  assert.equal(r.status, 'infeasible');
  assert.equal(r.shopping.length, 0);
  assert.ok(r.totalCost <= 150);
});

test('minimum packages increase checkout and leftovers while consumed nutrition and cost stay proportional', () => {
  const r = optimizeMenu(input({ budget: 200, proteinMin: 40 }), [offer({ minPacks: 2 })], [recipe()], now);
  assert.equal(r.status, 'met');
  assert.equal(r.shopping[0].packs, 2);
  assert.equal(r.shopping[0].usedGrams, 200);
  assert.equal(r.shopping[0].purchasedGrams, 1000);
  assert.equal(r.shopping[0].leftoverGrams, 800);
  assert.equal(r.shopping[0].cost, 200);
  assert.equal(r.totalCost, 200);
  assert.equal(r.consumedCost, 40);
  assert.equal(r.meals[0].ingredientCost, 40);
  assert.equal(r.macros.protein, 40);
});

test('minimum purchase cost is considered before collapsing equal labels or trimming offer options', () => {
  for (const distinctLabels of [false, true]) {
    const discounted = Array.from({ length: 10 }, (_, i) => offer({ id: `discount-${i}`, price: 70 + i, minPacks: 3, macros: { ...macros, protein: distinctLabels ? 20 + i : 20 } }));
    const r = optimizeMenu(input({ budget: 250 }), [...discounted, offer({ id: 'regular', price: 160 })], [recipe()], now);
    assert.equal(r.status, 'met');
    assert.equal(r.shopping[0].offer.id, 'regular');
    assert.equal(r.shopping[0].packs, 1);
    assert.equal(r.totalCost, 160);
  }
});

test('rejects invalid minimum package counts rather than ignoring their purchase condition', () => {
  for (const minPacks of [0, -1, 1.5, 101, NaN, Infinity, null, '2']) {
    const r = optimizeMenu(input({ budget: 200 }), [offer({ minPacks: minPacks as number })], [recipe()], now);
    assert.equal(r.feasible, false, String(minPacks));
    assert.equal(r.shopping.length, 0);
  }
});

test('accepts minimum-count boundaries and buys more than the minimum when demand requires it', () => {
  for (const minPacks of [1, 100]) {
    const r = optimizeMenu(input({ budget: minPacks * 100 }), [offer({ minPacks })], [recipe()], now);
    assert.equal(r.status, 'met');
    assert.equal(r.shopping[0].packs, minPacks);
  }
  const more = optimizeMenu(input({ budget: 300, proteinMin: 240 }), [offer({ minPacks: 2 })], [recipe('large', 600)], now);
  assert.equal(more.status, 'met');
  assert.equal(more.shopping[0].usedGrams, 1200);
  assert.equal(more.shopping[0].packs, 3);
  assert.equal(more.shopping[0].leftoverGrams, 300);
});

test('rounds up packages and chooses offers by checkout cost rather than unit price', () => {
  const r = optimizeMenu(input({ proteinMin: 110, budget: 160 }), [offer(), offer({ id: 'small', price: 80, packGrams: 300 })], [recipe('r', 300)], now);
  assert.equal(r.feasible, true);
  assert.equal(r.shopping[0].offer.id, 'small');
  assert.equal(r.shopping[0].packs, 2);
  assert.equal(r.totalCost, 160);
});

test('protein tolerance is a percentage and meeting target takes priority', () => {
  const r = optimizeMenu(input({ proteinMin: 100, proteinTolerance: 10 }), [offer({ macros: { ...macros, protein: 45 } })], [recipe()], now);
  assert.equal(r.status, 'tolerance');
  assert.equal(r.macros.protein, 90);
  assert.equal(r.proteinDeficit, 10);
  const exact = optimizeMenu(input({ proteinMin: 90, proteinTolerance: 20 }), [offer({ macros: { ...macros, protein: 60 } })], [recipe()], now);
  assert.equal(exact.status, 'met');
});

test('cheap menu outside protein tolerance is never success', () => {
  const r = optimizeMenu(input({ proteinMin: 100, proteinTolerance: 5 }), [offer({ price: 1 })], [recipe()], now);
  assert.equal(r.status, 'infeasible');
  assert.equal(r.feasible, false);
  assert.equal(r.proteinDeficit, 60);
  assert.match(r.message, /бел|недобор/i);
});

test('hard calorie, fat and carb maxima hold even when protein cannot be met', () => {
  for (const limit of [{ kcalMax: 75 }, { fatMax: 1.5 }, { carbsMax: 2.25 }]) {
    const r = optimizeMenu(input({ proteinMin: 20, proteinTolerance: 50, ...limit }), [offer()], [recipe()], now);
    assert.equal(r.status, 'tolerance');
    assert.equal(r.macros.protein, 10);
    if (limit.kcalMax) assert.ok(r.macros.kcal <= limit.kcalMax);
    if (limit.fatMax) assert.ok(r.macros.fat <= limit.fatMax);
    if (limit.carbsMax) assert.ok(r.macros.carbs <= limit.carbsMax);
  }
});

test('uses actual offer nutrition and searches non-cheapest label when a maximum requires it', () => {
  const r = optimizeMenu(input({ fatMax: 2 }), [offer({ price: 1, macros: { ...macros, fat: 100 } }), offer({ id: 'lean', price: 90, macros: { ...macros, protein: 30, fat: 1 } })], [recipe()], now);
  assert.equal(r.status, 'met');
  assert.equal(r.shopping[0].offer.id, 'lean');
  assert.equal(r.macros.protein, 30);
  assert.equal(r.macros.fat, 1);
});

test('rejects demo mixing, stale, future, pending, nonlocal and invalid offers', () => {
  const patches: Partial<Offer>[] = [ { demo: true }, { validUntil: now.toISOString() }, { observedAt: '2026-10-20T12:00:00Z' }, { status: 'pending' }, { localConfirmed: false }, { price: 0 }, { price: -1 }, { price: NaN }, { packGrams: 0 }, { packGrams: Infinity }, { macros: { ...macros, protein: NaN } }, { observedAt: 'invalid' } ];
  for (const patch of patches) {
    const r = optimizeMenu(input(), [offer(patch)], [recipe()], now);
    assert.equal(r.feasible, false, JSON.stringify(patch));
    assert.equal(r.shopping.length, 0);
  }
  assert.equal(optimizeMenu(input({ demo: true }), [offer()], [recipe()], now).feasible, false);
});

test('honors excluded ingredients, store scope and cooking time', () => {
  for (const patch of [{ excludedFoodIds: ['x'] }, { storeIds: ['b'] }, { storeIds: [] }, { maxMinutes: 5 }]) {
    assert.equal(optimizeMenu(input(patch), [offer()], [recipe()], now).feasible, false);
  }
});

test('can buy different ingredients in different selected stores', () => {
  const mixed = { ...recipe(), ingredients: [{ foodId: 'x', grams: 100 }, { foodId: 'y', grams: 100 }] };
  const r = optimizeMenu(input({ budget: 90, proteinMin: 40, storeIds: ['a', 'b'] }), [
    offer({ price: 50 }), offer({ id: 'b-x', storeId: 'b', price: 80 }),
    offer({ id: 'a-y', foodId: 'y', price: 80 }), offer({ id: 'b-y', foodId: 'y', storeId: 'b', price: 40 }),
  ], [mixed], now);
  assert.equal(r.status, 'met');
  assert.equal(r.totalCost, 90);
  assert.deepEqual(r.shopping.map(i => i.offer.id).sort(), ['a-x', 'b-y']);
});

test('never returns a menu violating a hard maximum as the closest failure', () => {
  const r = optimizeMenu(input({ proteinMin: 100, fatMax: 0.5 }), [offer()], [recipe()], now);
  assert.equal(r.status, 'infeasible');
  assert.equal(r.meals.length, 0);
  assert.equal(r.shopping.length, 0);
  assert.ok(r.macros.fat <= 0.5);
  assert.equal(r.proteinDeficit, 100);
});

test('aggregates repeated ingredient rows before purchasing and is deterministic', () => {
  const repeated = { ...recipe(), ingredients: [{ foodId: 'x', grams: 100 }, { foodId: 'x', grams: 100 }] };
  const args: Parameters<typeof optimizeMenu> = [input({ proteinMin: 60 }), [offer()], [repeated], now];
  const first = optimizeMenu(...args);
  assert.equal(first.status, 'met');
  assert.equal(first.shopping[0].usedGrams, 300);
  assert.equal(first.shopping[0].packs, 1);
  assert.deepEqual(first, optimizeMenu(...args));
});

test('empty data and insufficient distinct recipes return a useful failure', () => {
  for (const r of [optimizeMenu(input(), [], [], now), optimizeMenu(input({ meals: 2 }), [offer()], [recipe()], now)]) {
    assert.equal(r.status, 'infeasible');
    assert.ok(r.message.length > 10);
    assert.ok(r.algorithm.length > 10);
  }
});

test('demo catalog is internally consistent, explicitly synthetic and reproducible', () => {
  assert.ok(FOODS.length >= 18);
  assert.ok(RECIPES.length >= 8);
  assert.equal(STORES.length, 3);
  const offers = getDemoOffers(now);
  assert.deepEqual(offers, getDemoOffers(now));
  assert.ok(offers.every(o => o.demo && o.localConfirmed && o.status === 'confirmed' && o.nutritionEstimated));
  assert.ok(offers.every(o => Date.parse(o.validUntil) - Date.parse(o.observedAt) === 7 * 86400000));
  assert.ok(RECIPES.every(r => r.steps.length > 0 && r.ingredients.every(i => FOODS.some(f => f.id === i.foodId) && i.grams > 0)));
  const r = optimizeMenu(input({ budget: 1200, proteinMin: 120, meals: 3, storeIds: STORES.map(s => s.id), demo: true }), offers, RECIPES, now);
  assert.equal(r.feasible, true);
  assert.ok(r.totalCost <= 1200);
  assert.equal(r.meals.length, 3);
  assert.match(r.warnings.join(' '), /демо/i);
  assert.match(r.algorithm, /огранич|глобаль/i);
});
