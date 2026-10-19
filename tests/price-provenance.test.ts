import test from 'node:test';
import assert from 'node:assert/strict';
import type { Offer, PlanResult } from '../lib/domain.ts';
import { planIsOutdated, priceProvenance } from '../lib/price-provenance.ts';

const now = new Date('2026-10-19T12:00:00Z');
const offer = (patch: Partial<Offer> = {}): Offer => ({ id: 'oats', foodId: 'oats', name: 'Хлопья овсяные 400 г', storeId: 'magnit', price: 13.99, packGrams: 400, macros: { kcal: 350, protein: 12, fat: 5, carbs: 60 }, observedAt: '2026-10-18T12:00:00Z', validUntil: '2026-10-20T12:00:00Z', sourceUrl: 'https://proshoper.ru/kogalym/#id_product_1', evidence: 'Карточка цены', localConfirmed: true, nutritionEstimated: true, status: 'confirmed', demo: false, locality: 'city-catalog', ...patch });
const plan = (saved = offer()): PlanResult => ({ feasible: true, status: 'met', message: '', meals: [], shopping: [{ offer: saved, packs: 1, usedGrams: 100, purchasedGrams: 400, leftoverGrams: 300, cost: 13.99 }], macros: { kcal: 350, protein: 12, fat: 5, carbs: 60 }, totalCost: 13.99, consumedCost: 3.5, proteinDeficit: 0, warnings: [], searched: 1, algorithm: '' });

test('refreshing evidence and checked dates does not invalidate the same shopping price', () => {
  assert.equal(planIsOutdated(plan(), [offer({ observedAt: now.toISOString(), evidence: 'Карточка прочитана повторно', localEvidence: 'Когалым', nutritionObservedAt: now.toISOString() })], now), false);
});

test('current price changes invalidate the saved basket while unrelated offers do not', () => {
  assert.equal(planIsOutdated(plan(), [offer({ price: 22.99 })], now), true);
  assert.equal(planIsOutdated(plan(), [offer(), offer({ id: 'other', price: 100 })], now), false);
  assert.equal(planIsOutdated(plan(), [], now), true);
  assert.equal(planIsOutdated(plan(), [offer(),offer({id:'official',price:22.99,locality:'store',sourceUrl:'https://magnit.ru/product/3284010204?shopCode=121765'})], now), true);
});

test('product, package, store, purchase conditions and nutrition changes invalidate a plan', () => {
  for (const patch of [{ foodId: 'rice' }, { name: 'Другие хлопья 400 г' }, { storeId: '5ka' }, { packGrams: 380 }, { minPacks: 2 }, { priceCondition: 'От двух упаковок' }, { macros: { kcal: 300, protein: 8, fat: 4, carbs: 60 } }, { nutritionEstimated: false }, { sourceUrl: 'https://magnit.ru/product/another' }]) {
    assert.equal(planIsOutdated(plan(), [offer(patch)], now), true, JSON.stringify(patch));
  }
  assert.equal(planIsOutdated(plan(), [offer({ minPacks: 1 })], now), false);
});

test('status and locality eligibility changes invalidate the plan', () => {
  for (const patch of [{ status: 'pending' as const }, { localConfirmed: false }, { demo: true }, { locality: 'store' as const }]) assert.equal(planIsOutdated(plan(), [offer(patch)], now), true);
  for (const availability of ['out-of-stock', 'unknown']) assert.equal(planIsOutdated(plan(), [Object.assign(offer(), { availability })], now), true);
});

test('future, expired or malformed validity and future observations cannot be applied', () => {
  for (const patch of [{ validUntil: now.toISOString() }, { validUntil: 'invalid' }, { validFrom: '2026-10-20T00:00:00Z' }, { validFrom: 'invalid' }, { observedAt: '2026-10-20T00:00:00Z' }, { observedAt: 'invalid' }]) assert.equal(planIsOutdated(plan(), [offer(patch)], now), true);
  assert.equal(planIsOutdated(plan(), [offer({ validUntil: '2026-10-21T12:00:00Z' })], now), false);
  assert.equal(planIsOutdated(plan(offer({expiryKind:'promotion'})), [offer({expiryKind:'promotion', validUntil: '2026-10-21T12:00:00Z' })], now), true);
  assert.equal(planIsOutdated(plan(), [offer({ validFrom: '2026-10-18T00:00:00Z' })], now), true);
  assert.equal(planIsOutdated(plan(), [offer({ validUntil: '2026-10-20T17:00:00+05:00' })], now), false);
});

test('damaged numeric values and an invalid evaluation date cannot pass a stale check', () => {
  for (const patch of [{ price: NaN }, { price: 0 }, { packGrams: 0 }, { macros: { kcal: 300, protein: NaN, fat: 4, carbs: 60 } }]) assert.equal(planIsOutdated(plan(), [offer(patch)], now), true);
  assert.equal(planIsOutdated(plan(), [offer()], new Date('invalid')), true);
});

test('provenance names the actual price source and preserves product anchors', () => {
  const source = priceProvenance(offer());
  assert.equal(source.label, 'Proshoper');
  assert.equal(source.url, 'https://proshoper.ru/kogalym/#id_product_1');
  assert.match(source.checked, /18\.10\.2026/);
  assert.match(source.validity, /20\.10\.2026/);
  assert.match(source.scope, /[Гг]ородск/);
  assert.match(source.scope, /не подтвержден/);
  assert.equal(priceProvenance(offer({ sourceUrl: 'https://magnit.ru/product/3284010204?shopCode=121765' })).label, 'Магнит');
  assert.equal(priceProvenance(offer({ sourceUrl: 'https://example.org/product' })).label, 'example.org');
});

test('provenance never exposes an unsafe or malformed link', () => {
  for (const sourceUrl of ['javascript:alert(1)', 'data:text/html,test', '/relative', 'not a URL', 'https://user:password@example.org/']) assert.equal(priceProvenance(offer({ sourceUrl })).url, undefined, sourceUrl);
  assert.equal(priceProvenance(offer({ sourceUrl: 'http://example.org/p' })).url, 'http://example.org/p');
});

test('provenance distinguishes a store price from unconfirmed local availability', () => {
  const store = priceProvenance(offer({ locality: 'store' }));
  assert.match(store.scope, /конкретного магазина/);
  assert.match(store.scope, /наличие.*уточн/i);
  assert.match(priceProvenance(offer({ localConfirmed: false, locality: undefined })).scope, /не подтвержден/);
  const unknown = priceProvenance(offer({ observedAt: 'invalid', validUntil: 'invalid' }));
  assert.match(unknown.checked, /не указан/);
  assert.match(unknown.validity, /не подтвержд/);
});
