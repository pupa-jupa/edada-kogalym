import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProductMarkdown,searchWords} from '../lib/enrichment-sources.ts';

test('retailer main nutrition and package are parsed without taking recommended items',()=>{
  const result=parseProductMarkdown('# Макароны Шебекинские №202 Рожок полубублик 450г\nНа 100 г\nКкал\n350\nБелки\n13\nЖиры\n1.5\nУглеводы\n72\nПодробнее о товаре\nБрендШебекинские\n## Рекомендуем\nЙогурт 130г\nНа100г\nКкал99', 'https://magnit.ru/product/3174070007-makarony');
  assert.equal(result?.packGrams,450);assert.deepEqual(result?.macros,{kcal:350,protein:13,fat:1.5,carbs:72});assert.equal(result?.barcode,undefined);
});
test('manufacturer units are preserved and kJ is not mistaken for kcal',()=>{
  const result=parseProductMarkdown('# Крупа гречневая Увелка 800 г\nПищевая ценность на 100 г продукта:\nБелки 13 г.\nЖиры 2,5 г.\nУглеводы 61 г.\nЭнергетическая ценность/калорийность 1440 кДж/340 ккал\nМасса нетто 800 г','https://uvelka.ru/products/grechka');
  assert.deepEqual(result?.macros,{kcal:340,protein:13,fat:2.5,carbs:61});
});
test('incomplete, per 100ml, prepared and unscoped numbers do not become complete 100g nutrition',()=>{
  for(const text of ['# Молоко 1л\nНа 100 мл\nКкал52 Белки3 Жиры2.5 Углеводы4.7','# Тунец 170г\nНа 100г\nКкал90 Белки20 Жиры1','# Рис800г\nНа 100г готового продукта\nКкал120 Белки3 Жиры1 Углеводы20','# Хлеб400г\nБелки8 Жиры2 Углеводы50 Ккал250'])assert.equal(parseProductMarkdown(text,'https://magnit.ru/product/test'),null);
});
test('a page without a product heading and a foreign host cannot supply nutrition',()=>{
  assert.equal(parseProductMarkdown('На100г Ккал100 Белки10 Жиры2 Углеводы3','https://magnit.ru/catalog'),null);
  assert.equal(parseProductMarkdown('# Творог130г\nНа100г Ккал100 Белки10 Жиры2 Углеводы3','https://unknown.example/item'),null);
});
test('search query preserves distinctive names and escapes Lucene syntax',()=>{
  const q=searchWords('Йогурт «Актибио» клубника 2,9%, 130 г');assert.ok(q.includes('Актибио'));assert.ok(!q.includes('«'));assert.ok(q.length<220);
});
test('prepared basis across lines and related-product sections cannot supply raw label',()=>{
  assert.equal(parseProductMarkdown('# Рис Мистраль800г\nНа 100г\nприготовленного продукта\nКкал110 Белки3 Жиры1 Углеводы22','https://magnit.ru/product/rice'),null);
  assert.equal(parseProductMarkdown('# Творог Бренд130г\nНет сведений\n## Похожие\n# Творог Чужой130г\nНа 100г\nКкал90 Белки8 Жиры5 Углеводы3','https://magnit.ru/product/curd'),null);
});
