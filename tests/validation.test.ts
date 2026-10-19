import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOffer, validateRecipes, validateSourceUrl } from '../lib/validation.ts';
import { seal, unseal } from '../lib/secrets.ts';

const now = new Date('2026-10-19T12:00:00Z');
const offer = { id: 'o1', foodId: 'chicken', name: 'Филе', storeId: '5ka', price: 220, packGrams: 500, macros: { kcal: 110, protein: 23, fat: 2, carbs: 0 }, observedAt: '2026-10-19T10:00:00Z', validUntil: '2026-10-25T23:00:00Z', sourceUrl: '', evidence: 'Ценник магазина, Когалым', localConfirmed: true, nutritionEstimated: false, status: 'confirmed', demo: false };
test('rejects missing package size and impossible nutrition', () => {
  assert.throws(() => validateOffer({ ...offer, packGrams: 0 }, ['chicken'], now));
  assert.throws(() => validateOffer({ ...offer, macros: { ...offer.macros, fat: 100 } }, ['chicken'], now));
});
test('rejects future price observation and expired price interval', () => {
  assert.throws(() => validateOffer({ ...offer, observedAt: '2026-11-01T12:00:00Z' }, ['chicken'], now));
  assert.throws(() => validateOffer({ ...offer, validUntil: '2026-10-01T12:00:00Z' }, ['chicken'], now));
});
test('requires explicit locality before confirming a price', () => {
  assert.throws(() => validateOffer({ ...offer, localConfirmed: false }, ['chicken'], now));
  assert.equal(validateOffer({ ...offer, localConfirmed: false, status: 'pending' }, ['chicken'], now).status, 'pending');
});
test('rejects unknown food IDs and keeps real label macros', () => {
  assert.throws(() => validateOffer(offer, ['rice'], now));
  assert.equal(validateOffer(offer, ['chicken'], now).macros.protein, 23);
});
test('blocks private network sources, credentials and non-HTTPS schemes', () => {
  for (const url of ['http://5ka.ru', 'https://localhost', 'https://127.0.0.1/a', 'https://10.0.0.1', 'https://user:pass@5ka.ru', 'https://[::1]/', 'https://5ka.ru:8080/a']) assert.throws(() => validateSourceUrl(url));
  assert.equal(validateSourceUrl('https://magnit.ru/catalog/'), 'https://magnit.ru/catalog/');
});
test('rejects AI invented ingredients and duplicate ingredients', () => {
  const recipe = { id:'r', name:'Курица', description:'Блюдо', emoji:'🍲', minutes:20, ingredients:[{ foodId:'chicken', grams:150 }], steps:['Нарежьте филе.', 'Приготовьте до готовности.'], tags:[] };
  assert.throws(() => validateRecipes([{...recipe, ingredients:[{foodId:'gold',grams:10}]}], ['chicken']));
  assert.throws(() => validateRecipes([{...recipe,ingredients:[...recipe.ingredients,...recipe.ingredients]}], ['chicken']));
  assert.equal(validateRecipes([recipe], ['chicken'])[0].ingredients[0].grams, 150);
});
test('secrets roundtrip and tampering/wrong master key fail closed', async () => {
  const master = '11'.repeat(32);
  const encrypted = await seal('secret-api-key', master);
  assert.ok(!encrypted.includes('secret-api-key'));
  assert.equal(await unseal(encrypted, master), 'secret-api-key');
  await assert.rejects(() => unseal(encrypted, '22'.repeat(32)));
  await assert.rejects(() => unseal(encrypted.slice(0,-8) + 'AAAAAAAA', master));
});
