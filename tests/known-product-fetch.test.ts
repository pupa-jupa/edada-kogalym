import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../lib/known-product-fetch.ts';
import type {ProductCandidate} from '../lib/product-enrichment.ts';

const magnitUrl='https://magnit.ru/product/3174070007_makarony_450g';
const code='3017620422003';
const offUrl=`https://world.openfoodfacts.org/product/${code}`;
const webUrl='https://uvelka.ru/products/grechka';
const markdown='# Крупа гречневая Увелка 400г\nБренд: Увелка\nНа 100 г\nКкал: 350\nБелки: 13\nЖиры: 1.5\nУглеводы: 72';
const html='<main><h1>Крупа гречневая Увелка 400г</h1><p>Бренд: Увелка</p><h2>На 100 г</h2><p>Ккал: 350</p><p>Белки: 13</p><p>Жиры: 1.5</p><p>Углеводы: 72</p></main>';
const candidate=(url:string,extra:Partial<ProductCandidate>={}):ProductCandidate=>({productName:'Продукт 400г',sourceUrl:url,nutritionSourceUrl:url,observedAt:'2026-10-19T00:00:00Z',...extra});
const product=(id='3174070007')=>({id,name:'Макароны Шебекинские 450г',price:999,details:[{name:'На 100 г',type:'nutritionFactsType',parameters:[{name:'Ккал',value:'350'},{name:'Белки',value:'13'},{name:'Жиры',value:'1.5'},{name:'Углеводы',value:'72'}]}]});
const offProduct=(barcode=code)=>({product:{code:barcode,product_name:'Паста Бренд 400г',brands:'Бренд',quantity:'400г',nutrition:{aggregated_set:{per:'100g',preparation:'as_sold',nutrients:Object.fromEntries([['energy-kcal',350],['proteins',13],['fat',1.5],['carbohydrates',72]].map(([key,value])=>[key,{value,source_per:'100g',unit:key==='energy-kcal'?'kcal':'g',source:'manufacturer'}]))}}}});
function nuxtHtml(value:unknown):string{
 const table:unknown[]=[];function flatten(item:unknown):number{const i=table.length;table.push(null);table[i]=item!==null&&typeof item==='object'?(Array.isArray(item)?item.map(flatten):Object.fromEntries(Object.entries(item).map(([key,entry])=>[key,flatten(entry)]))):item;return i;}
 flatten(value);return `<script id="__NUXT_DATA__">${JSON.stringify(table)}</script>`;
}
type Call={url:string;init?:RequestInit};
function network(handler:(url:string,init?:RequestInit)=>Response|Promise<Response>){const calls:Call[]=[];return {calls,fetcher:(async(url:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(url),init});return handler(String(url),init);}) as typeof fetch};}

test('binds only exact supported product identities and rejects conflicting barcodes or unsafe URLs',()=>{
 assert.equal(typeof api.bindingForCandidate,'function');
 assert.deepEqual(api.bindingForCandidate(candidate(magnitUrl)),{kind:'magnit',url:magnitUrl,productId:'3174070007'});
 assert.deepEqual(api.bindingForCandidate(candidate(offUrl,{barcode:code})),{kind:'off',url:offUrl,productId:code});
 assert.deepEqual(api.bindingForCandidate(candidate(webUrl)),{kind:'web',url:webUrl});
 for(const url of ['http://uvelka.ru/p','https://evil.example/p','https://user:secret@uvelka.ru/p','https://magnit.ru/product/no-id','https://world.openfoodfacts.org/product/123'])assert.equal(api.bindingForCandidate(candidate(url)),undefined,url);
 assert.equal(api.bindingForCandidate(candidate(offUrl,{barcode:'4600000000008'})),undefined);
 assert.deepEqual(api.bindingForCandidate(candidate(webUrl,{userVerified:true})),{kind:'web',url:webUrl});
});

test('Magnit refresh fetches one exact ID with no discovery and never returns a reference-store price',async()=>{
 const net=network(()=>Response.json(product(),{headers:{etag:'"p1"'}}));
 const result=await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'3174070007'},{fetcher:net.fetcher});
 assert.equal(result.status,'ok');if(result.status!=='ok')return;
 assert.deepEqual(result.candidate.macros,{kcal:350,protein:13,fat:1.5,carbs:72});assert.equal(result.candidate.sourceUrl,magnitUrl);assert.equal('price' in result.candidate,false);
 assert.deepEqual(result.validators,{etag:'"p1"'});assert.equal(result.transport,'direct');
 assert.equal(net.calls.length,1);assert.match(net.calls[0].url,/\/webgate\/v2\/goods\/3174070007\/stores\/992301\?/);assert.equal(net.calls[0].init?.redirect,'manual');
});

test('OFF refresh uses the saved exact barcode and rejects a mismatched response',async()=>{
 const net=network(()=>Response.json(offProduct()));const result=await api.refreshKnownSource({kind:'off',url:offUrl,productId:code},{fetcher:net.fetcher});
 assert.equal(result.status,'ok');if(result.status==='ok'){assert.equal(result.candidate.barcode,code);assert.equal(result.candidate.packGrams,400);}
 assert.equal(net.calls.length,1);assert.match(net.calls[0].url,new RegExp(`/api/v3.6/product/${code}\\.json`));
 const wrong=network(()=>Response.json(offProduct('4600000000008')));assert.equal((await api.refreshKnownSource({kind:'off',url:offUrl,productId:code},{fetcher:wrong.fetcher})).status,'invalid');
});

test('conditional requests accept 304 only when a validator was sent for the primary representation',async()=>{
 const net=network(()=>new Response(null,{status:304,headers:{etag:'"next"'}}));
 const binding={kind:'web' as const,url:webUrl};
 const checked=await api.refreshKnownSource(binding,{fetcher:net.fetcher,validators:{etag:'"old"',lastModified:'Mon, 19 Oct 2026 00:00:00 GMT'}});
 assert.equal(checked.status,'unchanged');if(checked.status==='unchanged')assert.deepEqual(checked.validators,{etag:'"next"',lastModified:'Mon, 19 Oct 2026 00:00:00 GMT'});
 assert.equal(new Headers(net.calls[0].init?.headers).get('if-none-match'),'"old"');
 assert.equal((await api.refreshKnownSource(binding,{fetcher:net.fetcher})).status,'error');
});

test('transient and missing source responses never trigger search or alternate unrelated pages',async()=>{
 for(const status of [404,410,429,500,503]){
  const net=network(()=>new Response('',{status}));const result=await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'3174070007'},{fetcher:net.fetcher,firecrawlKey:'secret'});
  assert.equal(result.status,status===404||status===410?'missing':'error');assert.equal(net.calls.length,status===404||status===410?2:1);
  const web=network(()=>new Response('',{status}));const webResult=await api.refreshKnownSource({kind:'web',url:webUrl},{fetcher:web.fetcher,firecrawlKey:'secret'});
  assert.equal(webResult.status,status===404||status===410?'missing':'error');assert.equal(web.calls.length,1);
 }
 const net=network(()=>{throw new Error('timeout');});assert.equal((await api.refreshKnownSource({kind:'off',url:offUrl,productId:code},{fetcher:net.fetcher})).status,'error');assert.equal(net.calls.length,1);
});

test('Magnit checks the saved global PDP after reference-store missing, blocked or failed API requests',async()=>{
 for(const apiStatus of [403,404,410,'network']){
  const net=network(url=>{
   if(url.includes('/webgate/')){if(apiStatus==='network')throw new TypeError('fetch failed');return new Response('',{status:apiStatus as number});}
   assert.equal(url,magnitUrl);return new Response(nuxtHtml({data:{'goods-detail:3174070007:another-store':product()}}),{headers:{etag:'"html-only"'}});
  });
  const result=await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'3174070007'},{fetcher:net.fetcher,validators:{etag:'"api-only"'}});
  assert.equal(result.status,'ok',String(apiStatus));if(result.status==='ok'){assert.equal(result.candidate.sourceUrl,magnitUrl);assert.deepEqual(result.validators,{});}
  assert.equal(net.calls.length,2);assert.equal(new Headers(net.calls[1].init?.headers).has('if-none-match'),false);
 }
});

test('Magnit Firecrawl fallback retrieves raw HTML for only the saved PDP without an extraction prompt',async()=>{
 for(const field of ['rawHtml','html','markdown']){
  const savedHtml=nuxtHtml({data:{'goods-detail:3174070007:store':product()}});
  const net=network(url=>{
   if(url.includes('/webgate/'))throw new TypeError('fetch failed');
   if(url===magnitUrl)return new Response('',{status:403});
   assert.equal(url,'https://api.firecrawl.dev/v2/scrape');
   return Response.json({success:true,data:{[field]:field==='markdown'?'# Макароны Шебекинские 450г\nНа 100 г\nКкал: 350\nБелки: 13\nЖиры: 1.5\nУглеводы: 72':savedHtml,metadata:{sourceURL:magnitUrl,statusCode:200}}});
  });
  const result=await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'3174070007'},{fetcher:net.fetcher,firecrawlKey:'key',validators:{etag:'"api"'}});
  assert.equal(result.status,'ok',field);if(result.status==='ok'){assert.equal(result.transport,'firecrawl');assert.deepEqual(result.validators,{});assert.equal('price' in result.candidate,false);}
  assert.equal(net.calls.length,3);const body=JSON.parse(String(net.calls[2].init?.body));
  assert.equal(body.url,magnitUrl);assert.deepEqual(body.formats,['rawHtml','html','markdown']);assert.equal(body.onlyMainContent,false);assert.equal('prompt' in body,false);assert.equal(body.onlyCleanContent,false);assert.ok(body.timeout>=1000);
  assert.equal(new Headers(net.calls[2].init?.headers).has('if-none-match'),false);
 }
});

test('Magnit fallback rejects unrelated scraped identities and preserves transient errors on the global PDP',async()=>{
 const wrong=network(url=>url==='https://api.firecrawl.dev/v2/scrape'?Response.json({success:true,data:{rawHtml:nuxtHtml({data:{'goods-detail:3174070007:store':product('111')}}),metadata:{sourceURL:magnitUrl,statusCode:200}}}):new Response('',{status:403}));
 assert.equal((await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'3174070007'},{fetcher:wrong.fetcher,firecrawlKey:'key'})).status,'invalid');
 const redirected=network(url=>url==='https://api.firecrawl.dev/v2/scrape'?Response.json({success:true,data:{rawHtml:nuxtHtml({data:{'goods-detail:3174070007:store':product()}}),metadata:{sourceURL:magnitUrl,url:'https://magnit.ru/product/111',statusCode:200}}}):new Response('',{status:403}));
 assert.equal((await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'3174070007'},{fetcher:redirected.fetcher,firecrawlKey:'key'})).status,'invalid');
 for(const status of [429,500,503]){
  const net=network(url=>new Response('',{status:url.includes('/webgate/')?404:status}));
  assert.equal((await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'3174070007'},{fetcher:net.fetcher,firecrawlKey:'key'})).status,'error');assert.equal(net.calls.length,2);
 }
});

test('Firecrawl endpoint failure is not proof that the saved product disappeared',async()=>{
 const net=network(url=>new Response('',{status:url==='https://api.firecrawl.dev/v2/scrape'?404:403}));
 assert.equal((await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'3174070007'},{fetcher:net.fetcher,firecrawlKey:'key'})).status,'error');
});

test('Magnit metadata permits a canonical slug for the same Magnit ID but rejects other source kinds',async()=>{
 const canonical=network(url=>url==='https://api.firecrawl.dev/v2/scrape'?Response.json({success:true,data:{rawHtml:nuxtHtml({data:{'goods-detail:3174070007:store':product()}}),metadata:{sourceURL:magnitUrl,url:'https://magnit.ru/product/3174070007-new-slug/',statusCode:200}}}):new Response('',{status:403}));
 assert.equal((await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'3174070007'},{fetcher:canonical.fetcher,firecrawlKey:'key'})).status,'ok');
 const otherSource=network(url=>url==='https://api.firecrawl.dev/v2/scrape'?Response.json({success:true,data:{rawHtml:nuxtHtml({data:{[`goods-detail:${code}:store`]:product(code)}}),metadata:{sourceURL:offUrl,statusCode:200}}}):new Response('',{status:403}));
 assert.equal((await api.refreshKnownSource({kind:'magnit',url:`https://magnit.ru/product/${code}`,productId:code},{fetcher:otherSource.fetcher,firecrawlKey:'key'})).status,'invalid');
});

test('Magnit fallback body limits leave room for concurrent Worker state and parsing',async()=>{
 const savedHtml=nuxtHtml({data:{'goods-detail:3174070007:store':product()}});
 const direct=network(url=>url.includes('/webgate/')?new Response('',{status:403}):new Response(savedHtml,{headers:{'content-length':'4000001'}}));
 assert.equal((await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'3174070007'},{fetcher:direct.fetcher})).status,'error');
 const scraped=network(url=>url==='https://api.firecrawl.dev/v2/scrape'?Response.json({success:true,data:{rawHtml:savedHtml,metadata:{sourceURL:magnitUrl,statusCode:200}}},{headers:{'content-length':'6000001'}}):new Response('',{status:403}));
 assert.equal((await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'3174070007'},{fetcher:scraped.fetcher,firecrawlKey:'key'})).status,'error');
});

test('Magnit HTML fallback preserves the exact ID without mixing API or HTML validators',async()=>{
 const net=network(url=>url.includes('/webgate/')?Response.json({id:'different'},{headers:{etag:'"api"'}}):new Response(nuxtHtml({data:{'goods-detail:3174070007:992301:dostavka:3':product()}}),{headers:{etag:'"html"'}}));
 const result=await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'3174070007'},{fetcher:net.fetcher,validators:{etag:'"previous-api"'}});
 assert.equal(result.status,'ok');if(result.status==='ok')assert.deepEqual(result.validators,{});
 assert.equal(net.calls.length,2);assert.equal(net.calls[1].url,magnitUrl);assert.equal(new Headers(net.calls[1].init?.headers).has('if-none-match'),false);
 const wrong=network(url=>url.includes('/webgate/')?Response.json(product('111')):new Response(nuxtHtml({data:{'goods-detail:3174070007:x':product('111')}})));
 assert.equal((await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'3174070007'},{fetcher:wrong.fetcher})).status,'invalid');
});

test('saved allowlisted HTML is parsed deterministically and excludes recommendation nutrition',async()=>{
 const net=network(()=>new Response(html,{headers:{'last-modified':'Mon, 19 Oct 2026 00:00:00 GMT'}}));
 const result=await api.refreshKnownSource({kind:'web',url:webUrl},{fetcher:net.fetcher});
 assert.equal(result.status,'ok');if(result.status==='ok'){assert.equal(result.candidate.packGrams,400);assert.deepEqual(result.candidate.macros,{kcal:350,protein:13,fat:1.5,carbs:72});}
 assert.equal(net.calls.length,1);assert.equal(net.calls[0].url,webUrl);
 const recommendation='<main><h1>Крупа Увелка 400г</h1><h2>Похожие товары</h2><p>На 100 г Ккал: 350 Белки: 13 Жиры: 1.5 Углеводы: 72</p></main>';
 const related=network(()=>new Response(recommendation));assert.equal((await api.refreshKnownSource({kind:'web',url:webUrl},{fetcher:related.fetcher})).status,'invalid');
});

test('Firecrawl fallback scrapes only the saved URL and drops direct representation validators',async()=>{
 const net=network(url=>url===webUrl?new Response('<h1>Unavailable</h1>',{headers:{etag:'"page"'}}):Response.json({success:true,data:{markdown,metadata:{statusCode:200,sourceURL:webUrl}}}));
 const result=await api.refreshKnownSource({kind:'web',url:webUrl},{fetcher:net.fetcher,firecrawlKey:'key'});
 assert.equal(result.status,'ok');if(result.status==='ok'){assert.equal(result.transport,'firecrawl');assert.deepEqual(result.validators,{});assert.equal(result.candidate.sourceUrl,webUrl);}
 assert.equal(net.calls.length,2);assert.equal(net.calls[1].url,'https://api.firecrawl.dev/v2/scrape');
 const body=JSON.parse(String(net.calls[1].init?.body));assert.equal(body.url,webUrl);assert.deepEqual(body.formats,['markdown']);assert.equal('prompt' in body,false);
});

test('a blocked saved web page can use Firecrawl but returned redirects cannot replace its source identity',async()=>{
 const net=network(url=>url===webUrl?new Response('',{status:403}):Response.json({success:true,data:{markdown,metadata:{statusCode:200,sourceURL:webUrl}}}));
 assert.equal((await api.refreshKnownSource({kind:'web',url:webUrl},{fetcher:net.fetcher,firecrawlKey:'key'})).status,'ok');
 const redirected=network(url=>url===webUrl?new Response('',{status:403}):Response.json({success:true,data:{markdown,metadata:{statusCode:200,sourceURL:webUrl,url:'https://uvelka.ru/products/other'}}}));
 assert.equal((await api.refreshKnownSource({kind:'web',url:webUrl},{fetcher:redirected.fetcher,firecrawlKey:'key'})).status,'invalid');
});

test('invalid binding IDs, redirects, expired budgets and oversized bodies cannot yield successful facts',async()=>{
 const forbidden=network(()=>{throw new Error('Must not fetch');});
 assert.equal((await api.refreshKnownSource({kind:'magnit',url:magnitUrl,productId:'111'},{fetcher:forbidden.fetcher})).status,'invalid');
 assert.equal((await api.refreshKnownSource({kind:'web',url:'https://evil.example/p'},{fetcher:forbidden.fetcher})).status,'invalid');
 assert.equal((await api.refreshKnownSource({kind:'web',url:webUrl},{fetcher:forbidden.fetcher,deadline:Date.now()-1})).status,'error');assert.equal(forbidden.calls.length,0);
 const redirect=network(()=>new Response('',{status:302,headers:{location:'https://evil.example/'}}));assert.equal((await api.refreshKnownSource({kind:'web',url:webUrl},{fetcher:redirect.fetcher})).status,'error');assert.equal(redirect.calls.length,1);
 const oversized=network(()=>new Response(html,{headers:{'content-length':'13000000'}}));assert.equal((await api.refreshKnownSource({kind:'web',url:webUrl},{fetcher:oversized.fetcher})).status,'error');
});
