import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfferImport } from '../app/components/import-utils.ts';

test('CSV minimum packages is numeric so conditional prices keep their purchase minimum',()=>{
  const rows=parseOfferImport('foodId,price,packGrams,minPacks\nchicken,100,500,2');
  assert.equal(rows[0].minPacks,2);
});

test('CSV keeps commas, escaped quotes and line breaks inside quoted evidence', () => {
  const rows = parseOfferImport('foodId,name,storeId,price,packGrams,kcal,protein,fat,carbs,localConfirmed,nutritionEstimated,evidence\r\nchicken,"Филе, охлаждённое",5ka,229.90,600,113,23.6,1.9,0,true,false,"Когалым, чек ""42""\nобычная цена"');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Филе, охлаждённое');
  assert.equal(rows[0].evidence, 'Когалым, чек "42"\nобычная цена');
  assert.deepEqual(rows[0].macros, { kcal: 113, protein: 23.6, fat: 1.9, carbs: 0 });
  assert.equal(rows[0].price, 229.9);
  assert.equal(rows[0].localConfirmed, true);
  assert.equal(rows[0].nutritionEstimated, false);
  assert.equal(rows[0].demo, false);
});

test('JSON accepts an array or offers envelope without losing nested nutrition', () => {
  const row = {foodId:'egg',macros:{kcal:157,protein:12.7,fat:11.5,carbs:0.7},demo:false};
  assert.deepEqual(parseOfferImport(JSON.stringify([row])), [{...row,demo:false}]);
  assert.deepEqual(parseOfferImport(JSON.stringify({offers:[row]})), [{...row,demo:false}]);
});

test('CSV rejects ambiguous and truncated rows instead of silently changing data', () => {
  for (const csv of ['foodId,foodId\negg,egg', 'foodId,price\negg', 'foodId,price\negg,12,extra', 'foodId,name\negg,"unclosed', 'foodId,name\negg,"a"b']) {
    assert.throws(() => parseOfferImport(csv));
  }
});

test('CSV requires explicit numeric and boolean values', () => {
  assert.throws(() => parseOfferImport('foodId,price\negg,abc'), /числ/i);
  assert.throws(() => parseOfferImport('foodId,localConfirmed\negg,yes'), /true.*false/i);
  assert.throws(() => parseOfferImport('foodId,price\negg,'), /числ/i);
});

test('empty, oversized and non-object JSON imports are rejected as one batch', () => {
  for (const input of ['', '[]', '{}', '[null]', '[1]', JSON.stringify(Array.from({length:101},()=>({foodId:'egg'}))), 'x'.repeat(256001)]) {
    assert.throws(() => parseOfferImport(input));
  }
});

