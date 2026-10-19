import test from 'node:test';
import assert from 'node:assert/strict';
import {magnitPriceUrl,parseMagnitPrice} from '../lib/magnit-price.ts';
const url='https://magnit.ru/product/3284010204?shopCode=121765&shopType=express&catalogType=2&source=shareProduct';
const source={id:'oats-official',storeId:'magnit',url};
const name='Хлопья Моя цена Геркулес овсяные 400г';
const address='Ханты-Мансийский Автономный округ - Югра АО, г Когалым, проезд Сопочинского, д 2';
const metadata={title:`${name} – купить с доставкой | ${address}`,description:`${name} за 22.99₽. Купить из магазина Магнит по адресу: ${address}.`,sourceURL:url,url:url.replace('/3284010204?','/3284010204-moya_tsena_krupa_gerkules_fas_400g_6?')};
const now=new Date('2026-10-19T14:00:00Z');
// Scoped excerpt uses the observed official PDP classes/test IDs, including repeated responsive controls.
const html=(button='<button data-test-id="v-button-base"><span>Добавить в корзину</span></button>')=>`<div class="unit-product-details" data-test-id="v-product-detail"><div class="ecom-sticky-bar-top">22,99 ₽ <button>В корзину</button></div><div class="unit-product-details__offer"><h1 data-test-id="v-product-details-name">${name}</h1><div class="unit-product-details__price-container"><span data-test-id="v-product-detail-price-current"><span>22,99&#8202;₽</span></span><div class="unit-product-details__ecom">${button}</div></div><div class="unit-product-details__price-container"><span data-test-id="v-product-detail-price-current">22,99 ₽</span></div></div><section class="recommendations-products"><h2>Похожие</h2><div data-test-id="v-product-detail-price-current">13,99 ₽</div><button>Добавить в корзину</button></section></div>`;
test('only explicit Magnit product shop and channel links enter the deterministic adapter',()=>{
 assert.equal(magnitPriceUrl(url)?.shopCode,'121765');assert.equal(magnitPriceUrl(metadata.url)?.productId,'3284010204');
 for(const bad of [url.replace('https:','http:'),url.replace('magnit.ru','evil.example'),url.replace('shopType=express','shopType=dostavka'),url.replace('catalogType=2','catalogType=3'),url.replace('shopCode=121765&',''),url+'&shopCode=123',url.replace('/product/3284010204','/product/3284010204/reviews'),url.replace('shopCode=121765','shopCode=992301')])assert.equal(magnitPriceUrl(bad),undefined,bad);
});
test('primary PDP price is 22.99 despite related 13.99 and uses the explicit shop',()=>{
 const row=parseMagnitPrice(html(),source,metadata,now);
 assert.equal(row.id,'magnit:121765:3284010204');assert.equal(row.sourceId,'oats-official');assert.equal(row.sourceUrl,url);
 assert.equal(row.price,22.99);assert.equal(row.packGrams,400);assert.equal(row.priceUnit,'pack');assert.equal(row.name,name);
 assert.equal(row.availability,'in-stock');assert.equal(row.observedAt,'2026-10-19T14:00:00.000Z');assert.equal(row.validUntil,'2026-10-20T14:00:00.000Z');
 assert.match(row.localEvidence,/Когалым/);assert.match(row.evidence,/121765/);assert.equal(row.validFrom,undefined);
});
test('requested URL is insufficient if returned URL lost or changed shop context',()=>{
 for(const invalid of [{...metadata,url:metadata.url.replace('shopCode=121765&','')},{...metadata,url:metadata.url.replace('121765','999999')},{...metadata,url:metadata.url.replace('3284010204','123')},{...metadata,url:undefined},{...metadata,sourceURL:url.replace('121765','999999')}])assert.throws(()=>parseMagnitPrice(html(),source,invalid,now));
});
test('city and an actual street address must come from primary page metadata',()=>{
 for(const invalid of [{...metadata,title:metadata.title.replace('Когалым','Москва'),description:metadata.description.replace('Когалым','Москва')},{...metadata,title:name,description:'Купить в Когалыме'},{...metadata,title:`${name} Когалым`,description:`${name} Когалым`}])assert.throws(()=>parseMagnitPrice(html(),source,invalid,now));
});
test('recommendation cart buttons never prove primary availability and stock text is scoped',()=>{
 assert.equal(parseMagnitPrice(html(''),source,metadata,now).availability,'unknown');
 assert.equal(parseMagnitPrice(html('<button disabled>Добавить в корзину</button>'),source,metadata,now).availability,'unknown');
 assert.equal(parseMagnitPrice(html('<span>Нет в наличии</span>'),source,metadata,now).availability,'out-of-stock');
});
test('an explicit unavailable primary product stays unavailable even when its price disappears',()=>{
 const snapshot=html('<span>Нет в наличии</span>').replaceAll('data-test-id="v-product-detail-price-current"','data-test-id="removed-price"');
 const row=parseMagnitPrice(snapshot,source,metadata,now);
 assert.equal(row.availability,'out-of-stock');assert.equal(row.price,undefined);
});
test('missing primary prices, conflicting responsive values and recommendation-only names fail closed',()=>{
 for(const invalid of [html().replaceAll('v-product-detail-price-current','old-price'),html().replace('22,99 ₽</span>','23,99 ₽</span>'),html().replace('<h1 data-test-id="v-product-details-name">','<h2>').replace('</h1>','</h2>')])assert.throws(()=>parseMagnitPrice(invalid,source,metadata,now));
});
test('raw HTML head metadata and final response URL provide the same verified context',()=>{
 const page=`<head><title>${metadata.title}</title><meta name="description" content="${metadata.description}"></head>`+html();
 assert.equal(parseMagnitPrice(page,source,{url},now).price,22.99);
});
