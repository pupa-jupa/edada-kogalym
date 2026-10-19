import test from 'node:test';
import assert from 'node:assert/strict';
import type { Offer, PlanInput, Recipe } from '../lib/domain.ts';
import { preferStorePrices } from '../lib/offer-selection.ts';
import { optimizeMenu } from '../lib/optimizer.ts';
import { eligibleRecipeOffers } from '../lib/recipe-library.ts';
import { enrichmentSummary } from '../lib/enrichment.ts';

const now = new Date('2026-10-19T12:00:00Z');
const city = (patch: Partial<Offer> = {}): Offer => ({ id: 'city', foodId: 'oats', name: 'Хлопья Моя цена Геркулес овсяные 400г', storeId: 'magnit', price: 13.99, packGrams: 400, macros: { kcal: 350, protein: 12, fat: 5, carbs: 60 }, observedAt: '2026-10-19T10:00:00Z', validUntil: '2026-10-20T12:00:00Z', sourceUrl: 'https://proshoper.ru/kogalym/#product', evidence: 'Городской каталог', localConfirmed: true, nutritionEstimated: true, status: 'confirmed', demo: false, locality: 'city-catalog', ...patch });
const store = (patch: Partial<Offer> = {}): Offer => city({ id: 'store', price: 22.99, locality: 'store', sourceUrl: 'https://magnit.ru/product/3284010204?shopCode=121765&shopType=express&catalogType=2&source=shareProduct', ...patch });
const ids = (offers: Offer[]) => offers.map(offer => offer.id);

test('a verified exact store price supersedes a cheaper city catalog price without modifying input', () => {
  const offers = [city(), store()];
  assert.deepEqual(ids(preferStorePrices(offers, now)), ['store']);
  assert.deepEqual(offers.map(offer => offer.price), [13.99, 22.99]);
  assert.equal(preferStorePrices(offers, now)[0], offers[1]);
});

test('only Unicode, case, ё and whitespace are normalized in exact product identity', () => {
  const base = city({ name: 'ХЛОПЬЯ ЁЖ ４００г' });
  assert.deepEqual(ids(preferStorePrices([base, store({ name: ' хлопья   еж 400г ' })], now)), ['store']);
  for (const patch of [{ name: 'Хлопья Моя цена Геркулес 400г' }, { packGrams: 380 }, { storeId: '5ka' }, { name: 'Другой бренд 400г' }]) assert.deepEqual(ids(preferStorePrices([city(), store(patch)], now)), ['city', 'store']);
});

test('pending, unavailable, demo, invalid and inactive store offers cannot suppress city evidence', () => {
  for (const patch of [{ status: 'pending' as const }, { localConfirmed: false }, { demo: true }, { observedAt: '2026-10-20T00:00:00Z' }, { observedAt: 'invalid' }, { validFrom: '2026-10-20T00:00:00Z' }, { validFrom: 'invalid' }, { validUntil: now.toISOString() }, { validUntil: 'invalid' }, { price: 0 }, { packGrams: NaN }, { macros: { kcal: 350, protein: NaN, fat: 5, carbs: 60 } }]) assert.deepEqual(ids(preferStorePrices([city(), store(patch)], now)), ['city', 'store'], JSON.stringify(patch));
  assert.deepEqual(ids(preferStorePrices([city(), Object.assign(store(), { availability: 'out-of-stock' })], now)), ['city', 'store']);
});

test('only an official HTTPS store source can supersede the city price', () => {
  for (const sourceUrl of ['http://magnit.ru/product/1', 'https://proshoper.ru/product/1', 'https://magnit.ru.example.org/product', 'https://example.org/magnit.ru', 'https://5ka.ru/product/1', 'javascript:alert(1)', 'https://user:pass@magnit.ru/product/1']) assert.deepEqual(ids(preferStorePrices([city(), store({ sourceUrl })], now)), ['city', 'store'], sourceUrl);
  assert.deepEqual(ids(preferStorePrices([city(), store({ sourceUrl: 'https://www.magnit.ru/product/1' })], now)), ['store']);
});

test('the function preserves pending and expired city rows plus all unrelated rows', () => {
  const offers = [city({ id: 'pending-city', status: 'pending' }), city({ id: 'expired-city', validUntil: now.toISOString() }), city({ id: 'another-city', name: 'Другой продукт' }), city(), store()];
  assert.deepEqual(ids(preferStorePrices(offers, now)), ['pending-city', 'expired-city', 'another-city', 'store']);
  assert.deepEqual(ids(preferStorePrices(offers, new Date('invalid'))), ids(offers));
});

test('optimizer, recipe eligibility and menu-ready counts all use the precise 22.99 price', () => {
  const offers = [city(), store()];
  const input: PlanInput = { budget: 100, proteinMin: 1, proteinTolerance: 0, meals: 1, maxMinutes: 15, storeIds: ['magnit'], excludedFoodIds: [], demo: false };
  const recipe: Recipe = { id: 'porridge', name: 'Каша', description: 'Овсяная каша', emoji: '🥣', minutes: 10, ingredients: [{ foodId: 'oats', grams: 100 }], steps: ['Сварить кашу'], tags: [] };
  const result = optimizeMenu(input, offers, [recipe], now);
  assert.equal(result.feasible, true);
  assert.equal(result.totalCost, 22.99);
  assert.equal(result.shopping[0].offer.id, 'store');
  assert.equal(result.shopping[0].offer.sourceUrl, offers[1].sourceUrl);
  assert.deepEqual(ids(eligibleRecipeOffers(offers, input, now)), ['store']);
  assert.equal(enrichmentSummary([], [], offers, now).menuReady, 1);
});
