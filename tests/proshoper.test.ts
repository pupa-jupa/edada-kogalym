import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProshoper, getProshoperPages, parseProshoperFragment } from '../lib/proshoper.ts';

const now = new Date('2026-10-19T12:00:00Z');
const source = { id: 'local-magnit', storeId: 'magnit', url: 'https://proshoper.ru/kogalym/actions/magnit-magazin/' };
const city = '<h1>Каталог акций «Магнит у дома» <span>— Когалым</span></h1>';
const card = (id: number, name: string, price = '') => `<article id="id_product_${id}" class="product"><div class="product__name">${name}</div>${price}</article>`;
const price = '<span class="product__price-new">75<span class="text-50% align-super">99</span><span>₽</span></span><span class="product__price-old">99<span>99</span>₽</span>';

test('keeps incomplete cards and reads rubles plus kopeks without the old price', () => {
  const rows = parseProshoper(city + card(1, 'Морковь мытая упаковка 1кг', price) + card(2, 'Яблоки') + card(3, 'Губка для посуды', '<img alt="Губка 500г"/>'), source, now);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].price, 75.99);
  assert.equal(rows[0].packGrams, 1000);
  assert.equal(rows[1].name, 'Яблоки');
  assert.equal(rows[1].price, undefined);
  assert.equal(rows[1].packGrams, undefined);
  assert.equal(rows[2].packGrams, undefined);
  assert.ok(rows.every(row => row.availability === 'listed' && row.observedAt === '2026-10-19T12:00:00.000Z'));
  assert.equal(rows[0].sourceUrl, 'https://proshoper.ru/kogalym/actions/magnit-magazin/#id_product_1');
  assert.equal(rows[0].id, parseProshoper(city + card(1, 'Новое имя', price), source, now)[0].id);
  assert.notEqual(rows[0].id, parseProshoper(city + card(1, 'Морковь', price), { ...source, id: 'another-source' }, now)[0].id);
});

test('does not accept a Kogalym URL, script or incidental mention as city confirmation', () => {
  for (const html of [card(1, 'Морковь'), '<h1>Каталог — Москва</h1><footer>Также скидки Когалыма</footer>' + card(1, 'Морковь'), '<script>const city="Когалым"</script>' + card(1, 'Морковь')]) {
    assert.throws(() => parseProshoper(html, source, now), /Когалым/);
  }
  assert.equal(parseProshoper('<a href="/cities/">Когалым</a>' + card(1, 'Рис'), source, now).length, 1);
});

test('assigns dates only inside the corresponding campaign and leaves ambiguous siblings undated', () => {
  const html = city + `<section class="catalog"><h2 class="catalog_dates">с 13 по 19 октября 2026</h2>${card(1, 'Гречка 800г')}</section>`
    + `<section class="catalog"><h2 class="catalog_dates">с 20 по 26 октября 2026</h2>${card(2, 'Рис 900г')}</section>` + card(3, 'Без срока');
  const rows = parseProshoper(html, source, now);
  assert.equal(rows[0].validFrom, '2026-10-13T00:00:00+05:00');
  assert.equal(rows[0].validUntil, '2026-10-19T23:59:59.999+05:00');
  assert.equal(rows[1].validFrom, '2026-10-20T00:00:00+05:00');
  assert.equal(rows[2].validUntil, undefined);
  const ambiguous = parseProshoper(city + `<section class="block"><h2 class="catalog_dates">с 13 по 19 октября 2026</h2><h2 class="catalog_dates">с 20 по 26 октября 2026</h2>${card(4, 'Без привязки')}</section>`, source, now);
  assert.equal(ambiguous[0].validUntil, undefined);
});

test('distinguishes kilogram unit prices, multipacks and volume without guessing density', () => {
  const rows = parseProshoper(city + card(1, 'Яблоки, 1 кг') + card(2, 'Рис 5пак*80г') + card(3, 'Масло 1л') + card(4, 'Филе 950г (199,99₽/1кг)'), source, now);
  assert.equal(rows[0].priceUnit, 'kg');
  assert.equal(rows[0].packGrams, undefined);
  assert.equal(rows[1].packGrams, 400);
  assert.equal(rows[1].priceUnit, 'pack');
  assert.equal(rows[2].packText, '1л');
  assert.equal(rows[2].packGrams, undefined);
  assert.equal(rows[3].packGrams, 950);
});

test('extracts captured real Proshoper article structure and decodes entities', () => {
  const html = `<section class="block"><header>${city}<div><h2 class="catalog_dates mr-4">с 14 по 20 октября 2026</h2></div></header><section id="id_products_section"><article id="id_product_51893785" class="product"><picture><img alt="Огурцы 450г"/></picture><div class="product__descr"><div class="product__price"><span class="product__price-new">114<span class="text-50% align-super">99</span><span class="ml-1 font-medium">₽</span></span></div><div class="product__name">Огурцы&nbsp;короткоплодные тепличные 450г</div></div></article></section></section>`;
  const [row] = parseProshoper(html, source, now);
  assert.equal(row.name, 'Огурцы короткоплодные тепличные 450г');
  assert.equal(row.price, 114.99);
  assert.equal(row.packGrams, 450);
  assert.equal(row.validUntil, '2026-10-20T23:59:59.999+05:00');
});

test('uses the retained city breadcrumb when content filtering removed headers', () => {
  const html = '<div class="breadcrumbs"><a href="/kogalym/" class="breadcrumbs-home" title="Прошопер — Когалым"><i class="fa fa-home"></i></a></div>' + card(7, 'Рис 800г', price);
  const [row] = parseProshoper(html, source, now);
  assert.equal(row.price, 75.99);
  assert.match(row.localEvidence, /Прошопер — Когалым/);
  assert.equal(row.validUntil, undefined);
});

test('malformed campaign dates leave a listing undated instead of losing the batch', () => {
  const [row] = parseProshoper(city + `<section class="catalog"><h2 class="catalog_dates">с 99 по 99 октября 2026</h2>${card(9, 'Рис 800г')}</section>`, source, now);
  assert.equal(row.name, 'Рис 800г');
  assert.equal(row.validUntil, undefined);
});

test('does not lift the only date from a neighbouring nested campaign into a page section', () => {
  const html = `<section class="page">${city}<section class="catalog"><h2 class="catalog_dates">с 13 по 19 октября 2026</h2>${card(1, 'Первый товар')}</section><section class="catalog">${card(2, 'Другой каталог без даты')}</section></section>`;
  const rows = parseProshoper(html, source, now);
  assert.equal(rows[0].validUntil, '2026-10-19T23:59:59.999+05:00');
  assert.equal(rows[1].validUntil, undefined);
});

test('discovers only observed same-origin spoiler links and retains their campaign scope', () => {
  const html = `<section class="catalog">${city}<h2 class="catalog_dates">с 14 по 20 октября 2026</h2><div hx-get="/_catalog_products_spoiler/334792/?cat=2&amp;skip=24">Ещё</div><div hx-get="/_catalog_products_spoiler/334792/?cat=2&amp;skip=24">Дубликат</div><div hx-get="https://evil.example/_catalog_products_spoiler/334792/?cat=3">Чужой</div><div hx-get="/api/private">Другое</div><div hx-get="https://proshoper.ru.evil.example/_catalog_products_spoiler/334792/">Подмена</div></section>`;
  const pages = getProshoperPages(html, source);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].url, 'https://proshoper.ru/_catalog_products_spoiler/334792/?cat=2&skip=24');
  assert.equal(pages[0].validUntil, '2026-10-20T23:59:59.999+05:00');
  assert.match(pages[0].localEvidence, /Когалым/);
  assert.throws(() => getProshoperPages(html.replace(city, ''), source), /Когалым/);
});

test('fragment parsing inherits observed link metadata while preserving root product URLs', () => {
  const [context] = getProshoperPages(`<section class="catalog">${city}<h2 class="catalog_dates">с 14 по 20 октября 2026</h2><div hx-get="/_catalog_products_spoiler/334792/?cat=2&amp;skip=24">Ещё</div></section>`, source);
  const fragment = card(51894120, 'Творог Першинское обезжиренный 380г', price) + card(44, 'Без фасовки');
  const rows = parseProshoperFragment(fragment, source, context, now);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sourceUrl, 'https://proshoper.ru/kogalym/actions/magnit-magazin/#id_product_51894120');
  assert.equal(rows[0].packGrams, 380);
  assert.equal(rows[0].validUntil, '2026-10-20T23:59:59.999+05:00');
  assert.equal(rows[0].localEvidence, context.localEvidence);
  assert.equal(rows[0].availability, 'listed');
  assert.throws(() => parseProshoper(fragment, source, now), /Когалым/);
  assert.throws(() => parseProshoperFragment(fragment, source, { ...context, url: 'https://evil.example/fragment' }, now));
});

test('fragments discover observed next pages with trusted context and explicit dates take priority', () => {
  const context = { url: 'https://proshoper.ru/_catalog_products_spoiler/334792/?cat=2&skip=24', localEvidence: 'Каталог Когалыма проверен', validFrom: '2026-10-14T00:00:00+05:00', validUntil: '2026-10-20T23:59:59.999+05:00' };
  const fragment = `<section class="catalog"><h2 class="catalog_dates">с 21 по 27 октября 2026</h2>${card(4, 'Рис 800г')}<div hx-get="/_catalog_products_spoiler/334792/?cat=2&amp;skip=48">Дальше</div></section>`;
  assert.equal(parseProshoperFragment(fragment, source, context, now)[0].validUntil, '2026-10-27T23:59:59.999+05:00');
  const pages = getProshoperPages(fragment, source, context);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].url, 'https://proshoper.ru/_catalog_products_spoiler/334792/?cat=2&skip=48');
  assert.equal(pages[0].validUntil, '2026-10-27T23:59:59.999+05:00');
  const inherited = getProshoperPages('<div hx-get="/_catalog_products_spoiler/334792/?cat=2&amp;skip=72">Ещё</div>', source, context);
  assert.equal(inherited[0].validUntil, context.validUntil);
});
