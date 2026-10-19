import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMagnitSitemap,retailerTargets,type MagnitProduct} from '../lib/retailer-index.ts';
import {enrichmentKey} from '../lib/product-enrichment.ts';
import type {CatalogListing} from '../lib/proshoper.ts';

const listing=(name:string,id='local'):CatalogListing=>({id,name,storeId:'5ka',sourceId:'local',sourceUrl:'https://proshoper.ru/kogalym/',price:99,priceUnit:'pack',availability:'listed',observedAt:'2026-10-19T12:00:00Z',lastSeenAt:'2026-10-19T12:00:00Z',evidence:'Когалым',localEvidence:'Когалым'});
const product=(id:string,slug:string):MagnitProduct=>({id,slug,url:`https://magnit.ru/product/${id}-${slug}`});
// An unrelated catalog gives the real ranker's IDF threshold meaningful context.
const fillers=Array.from({length:80},(_,i)=>product(String(80000+i),`unrelated${i}_filler${i}`));

test('sitemap accepts only https Magnit product URLs and deduplicates product IDs',()=>{
  const xml='<urlset><url><loc>https://magnit.ru/product/123-test_slug</loc></url><url><loc>https://magnit.ru/product/123-test_slug</loc></url><url><loc>https://magnit.ru/product/124-second</loc></url><loc>http://magnit.ru/product/999-bad</loc><loc>https://magnit.ru.evil.test/product/998-bad</loc><loc>https://other.test/product/997-bad</loc><loc>https://magnit.ru/product/not-an-id</loc><loc>https://magnit.ru/product/996-bad?redirect=x</loc><loc>https://user@magnit.ru/product/995-bad</loc></urlset>';
  assert.deepEqual(parseMagnitSitemap(xml),[product('123','test_slug'),product('124','second')]);
  assert.deepEqual(parseMagnitSitemap('not xml <loc>https://other.test/product/1-x</loc>'),[]);
  assert.deepEqual(parseMagnitSitemap('<urlset><loc>https://magnit.ru/product/1-unclosed'),[]);
});
test('Cyrillic names find transliterated and inflected sitemap variants',()=>{
  const row=listing('Макароны Шебекинские рожок полубублик 450г');
  const target=product('123','makarony_shebekinskie_rozhki_polubublik_450g');
  assert.deepEqual(retailerTargets([row],[target,...fillers]),[{key:enrichmentKey(row),urls:[target.url]}]);
});
test('matching mass takes priority and each listing has at most three URLs',()=>{
  const row=listing('Крупа Увелка гречневая ядрица 500г');
  const products=[product('100','uvelka_krupa_grechnevaya_yadritsa_900g'),product('101','uvelka_krupa_grechnevaya_yadritsa_500g'),product('102','uvelka_krupa_grechnevaya_yadritsa_800g'),product('103','uvelka_krupa_grechnevaya_yadritsa_400g')];
  const [result]=retailerTargets([row],[...products,...fillers]);
  assert.equal(result.urls[0],products[1].url);
  assert.equal(result.urls.length,3);
});
test('duplicate enrichment keys collapse while distinct keys can share one URL',()=>{
  const a=listing('Макароны Шебекинские рожки полубублик 450г','a');
  const b={...a,id:'b',storeId:'magnit'};
  const c=listing('Макароны Шебекинские рожки полубублик 500г','c');
  const target=product('123','makarony_shebekinskie_rozhki_polubublik_450g');
  const result=retailerTargets([a,b,c],[target,target,...fillers]);
  assert.deepEqual(result,[{key:enrichmentKey(a),urls:[target.url]},{key:enrichmentKey(c),urls:[target.url]}]);
});
test('unmatched listings retain their keys with empty URL arrays',()=>{
  const rows=[listing('Неизвестный фруктовый рулет 300г'),listing('Совсем другой товар 90г')];
  assert.deepEqual(retailerTargets(rows,fillers),rows.map(row=>({key:enrichmentKey(row),urls:[]})));
  assert.deepEqual(retailerTargets(rows,[]),rows.map(row=>({key:enrichmentKey(row),urls:[]})));
});
