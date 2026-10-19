import {allowedProductUrl,parseProductMarkdown} from './enrichment-sources.ts';
import {parseNutrition,validBarcode} from './nutrition.ts';
import {parseMass,type ProductCandidate} from './product-enrichment.ts';
import {parseMagnitHtml,parseMagnitProduct} from './retailer-reference.ts';

export type KnownSourceBinding={kind:'magnit'|'off'|'web';url:string;productId?:string};
export type SourceValidators={etag?:string;lastModified?:string};
type Transport='direct'|'firecrawl';
export type KnownSourceResult=
 | {status:'ok';candidate:ProductCandidate;validators:SourceValidators;transport:Transport}
 | {status:'unchanged';validators:SourceValidators;transport:Transport}
 | {status:'missing'|'invalid'|'error';reason:string;validators?:SourceValidators};
type Options={fetcher?:typeof fetch;deadline?:number;validators?:SourceValidators;firecrawlKey?:string};

/** Bind only the nutrition's actual source; a retail ID is never inferred as a GTIN. */
export function bindingForCandidate(candidate:ProductCandidate):KnownSourceBinding|undefined{
 const value=candidate.nutritionSourceUrl??candidate.sourceUrl;
 try{
  const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return;
  u.hash='';const url=u.href;
  if(u.hostname==='magnit.ru'){
   const id=u.pathname.match(/^\/product\/(\d+)(?:[_-][^/]*)?\/?$/)?.[1];
   return id?{kind:'magnit',url,productId:id}:undefined;
  }
  if(u.hostname==='openfoodfacts.org'||u.hostname.endsWith('.openfoodfacts.org')){
   const code=u.pathname.match(/^\/product\/(\d+)(?:\/[^/]+)?\/?$/)?.[1];
   if(!code||!validBarcode(code)||candidate.barcode&&candidate.barcode!==code)return;
   return {kind:'off',url,productId:code};
  }
  if(allowedProductUrl(url))return {kind:'web',url};
 }catch{/* Invalid saved identity is eligible for separate discovery. */}
}
function validBinding(binding:KnownSourceBinding):boolean{
 const derived=bindingForCandidate({productName:'Saved identity',sourceUrl:binding.url,observedAt:''});
 return !!derived&&derived.kind===binding.kind&&derived.url===binding.url&&derived.productId===binding.productId;
}
function validators(headers:Headers,previous:SourceValidators={}):SourceValidators{
 const etag=headers.get('etag')??previous.etag,lastModified=headers.get('last-modified')??previous.lastModified;
 return {...(etag?{etag}:{}),...(lastModified?{lastModified}:{})};
}
class SourceFailure extends Error{
 status:'missing'|'invalid'|'error';
 constructor(status:'missing'|'invalid'|'error',reason:string){super(reason);this.status=status;}
}
async function boundedText(response:Response,maximum:number):Promise<string>{
 if(Number(response.headers.get('content-length'))>maximum){await response.body?.cancel();throw new SourceFailure('error','Страница превысила ограничение размера');}
 const reader=response.body?.getReader();if(!reader)return '';
 const decoder=new TextDecoder();let bytes=0,text='';
 try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>maximum){await reader.cancel();throw new SourceFailure('error','Страница превысила ограничение размера');}text+=decoder.decode(chunk.value,{stream:true});}return text+decoder.decode();}
 finally{reader.releaseLock();}
}
function textEntities(value:string):string{
 return value.replace(/&(?:nbsp|amp|quot|apos|lt|gt);|&#(?:\d+|x[0-9a-f]+);/gi,entity=>{
  const names:Record<string,string>={'&nbsp;':' ','&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'};
  if(names[entity.toLowerCase()])return names[entity.toLowerCase()];
  const code=entity[2].toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):Number(entity.slice(2,-1));
  return code>0&&code<=0x10ffff?String.fromCodePoint(code):' ';
 });
}
/** A small deterministic main-content converter; scripts and related-product headings stay outside facts. */
function productMarkdown(html:string):string{
 const cleaned=html.replace(/<(script|style|noscript|nav|aside|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
 const main=cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1]??cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1]??cleaned;
 if((main.match(/<h1\b/gi)??[]).length!==1)return '';
 return textEntities(main.replace(/<h([1-6])\b[^>]*>/gi,(_,level:string)=>'\n'+'#'.repeat(Number(level))+' ')
  .replace(/<\/(?:h[1-6]|p|div|section|li|tr|dt|dd)\s*>|<br\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' '))
  .split('\n').map(line=>line.replace(/[ \t]+/g,' ').trim()).join('\n');
}

/** Fetches a saved identity only. No search endpoint or language model is used. */
export async function refreshKnownSource(binding:KnownSourceBinding,options:Options={}):Promise<KnownSourceResult>{
 if(!validBinding(binding))return {status:'invalid',reason:'Сохранённая ссылка или ID товара недопустимы'};
 const fetcher=options.fetcher??fetch,deadline=Math.min(options.deadline??Date.now()+30000,Date.now()+30000);
 const baseHeaders={'User-Agent':'Mozilla/5.0 (compatible; Edada/0.5)','Accept':'text/html,application/json'};
 const request=async(url:string,init:RequestInit={},primary=false,maximum=2500000):Promise<{text:string;validators:SourceValidators;unchanged:boolean}>=>{
  const remaining=deadline-Date.now();if(remaining<=0)throw new SourceFailure('error','Недостаточно времени для проверки источника');
  const conditional=new Headers({...baseHeaders,...init.headers});
  if(primary){if(options.validators?.etag)conditional.set('If-None-Match',options.validators.etag);if(options.validators?.lastModified)conditional.set('If-Modified-Since',options.validators.lastModified);}
  const response=await fetcher(url,{...init,headers:conditional,redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(18000,remaining)))});
  if(response.status===304){
   await response.body?.cancel();
   if(!primary||!conditional.has('if-none-match')&&!conditional.has('if-modified-since'))throw new SourceFailure('error','Источник вернул 304 без условного запроса');
   return {text:'',validators:validators(response.headers,options.validators),unchanged:true};
  }
  if(!response.ok){await response.body?.cancel();throw new SourceFailure(response.status===404||response.status===410?'missing':'error',`Источник: HTTP ${response.status}`);}
  return {text:await boundedText(response,maximum),validators:primary?validators(response.headers):{},unchanged:false};
 };
 const scrapeSaved=async(magnit=false):Promise<any>=>{
  const remaining=deadline-Date.now();if(remaining<1100)throw new SourceFailure('error','Недостаточно времени для резервной проверки источника');
  // rawHtml retains the exact Nuxt goods-detail entry; no AI extraction/cleaning is requested.
  const page=await request('https://api.firecrawl.dev/v2/scrape',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${options.firecrawlKey}`},body:JSON.stringify({url:binding.url,maxAge:0,onlyMainContent:!magnit,onlyCleanContent:false,formats:magnit?['rawHtml','html','markdown']:['markdown'],timeout:Math.min(15000,remaining-100)})},false,magnit?6000000:2500000).catch(error=>{
   // The scrape service's own 404 does not establish the target page's status.
   if(error instanceof SourceFailure&&error.status==='missing')throw new SourceFailure('error','Firecrawl недоступен: '+error.message);
   throw error;
  });
  let data:any;try{data=JSON.parse(page.text);}catch{throw new SourceFailure('error','Firecrawl вернул некорректный ответ');}
  const status=Number(data.data?.metadata?.statusCode??200);
  if(status===404||status===410)throw new SourceFailure('missing','Сохранённая страница больше не существует');
  if(data.success===false||status!==200||!data.data)throw new SourceFailure('error','Firecrawl не подтвердил сохранённую страницу');
  const returnedUrls=[data.data.metadata?.sourceURL,data.data.metadata?.url].filter(Boolean);
  const sameSource=(url:string)=>{
   if(url===binding.url)return true;
   const derived=magnit?bindingForCandidate({productName:'Saved identity',sourceUrl:url,observedAt:''}):undefined;
   return derived?.kind==='magnit'&&derived.productId===binding.productId;
  };
  if(returnedUrls.some(url=>typeof url!=='string'||!sameSource(url)))throw new SourceFailure('invalid','Firecrawl вернул другую карточку');
  return data.data;
 };
 try{
  if(binding.kind==='off'){
   const data=await request(`https://world.openfoodfacts.org/api/v3.6/product/${binding.productId}.json?fields=code,product_name,brands,quantity,nutrition,nutriments`,{},true);
   if(data.unchanged)return {status:'unchanged',validators:data.validators,transport:'direct'};
   try{
    const c=parseNutrition(JSON.parse(data.text),binding.productId!);
    const candidate:ProductCandidate={productName:c.productName,brand:c.brand,barcode:c.code,quantityText:c.quantity,packGrams:parseMass(c.quantity),macros:c.macros,sourceUrl:binding.url,nutritionSourceUrl:binding.url,quantitySourceUrl:c.quantity?binding.url:undefined,observedAt:c.observedAt,estimated:c.estimated,evidence:`Open Food Facts: ${c.productName}; ${c.quantity}; полные значения на 100 г, as_sold.`};
    return {status:'ok',candidate,validators:data.validators,transport:'direct'};
   }catch{return {status:'invalid',reason:'Open Food Facts не подтвердил сохранённый штрихкод и полные КБЖУ на 100 г'};}
  }
  if(binding.kind==='magnit'){
   let candidate:ProductCandidate|null=null;
   try{
    const data=await request(`https://magnit.ru/webgate/v2/goods/${binding.productId}/stores/992301?storetype=dostavka&catalogtype=3`,{headers:{'x-platform':'Web','x-magnit-bff':'1'}},true);
    if(data.unchanged)return {status:'unchanged',validators:data.validators,transport:'direct'};
    try{candidate=parseMagnitProduct(JSON.parse(data.text),binding.url);}catch{/* Some PDP responses need the public HTML representation. */}
    if(candidate)return {status:'ok',candidate,validators:data.validators,transport:'direct'};
   }catch(error){
    // Store 992301 is a reference context: its 404 is not proof the global product disappeared.
    if(error instanceof SourceFailure&&!/HTTP (?:403|404|410)$/.test(error.message))throw error;
   }
   let pageFailure:unknown;
   try{
    const page=await request(binding.url,{},false,4000000);candidate=parseMagnitHtml(page.text,binding.url);
    if(candidate)return {status:'ok',candidate,validators:{},transport:'direct'};
   }catch(error){
    if(error instanceof SourceFailure&&!/HTTP 403$/.test(error.message))throw error;
    pageFailure=error;
   }
   if(options.firecrawlKey){
    const data=await scrapeSaved(true);
    for(const html of [data.rawHtml,data.html]){
     if(typeof html!=='string')continue;
     candidate=parseMagnitHtml(html,binding.url);
     if(candidate)return {status:'ok',candidate,validators:{},transport:'firecrawl'};
     // A present primary Nuxt record must pass the strict ID/basis parser.
     if(/\bid=["']__NUXT_DATA__["']/i.test(html))return {status:'invalid',reason:'Карточка Магнита не подтвердила сохранённый ID и полные характеристики'};
    }
    if(typeof data.markdown==='string')candidate=parseProductMarkdown(data.markdown,binding.url);
    if(candidate)return {status:'ok',candidate,validators:{},transport:'firecrawl'};
   }
   if(pageFailure)throw pageFailure;
   return {status:'invalid',reason:'Карточка Магнита не подтвердила сохранённый ID и полные характеристики'};
  }
  let directFailure:SourceFailure|undefined;
  try{
   const page=await request(binding.url,{},true);
   if(page.unchanged)return {status:'unchanged',validators:page.validators,transport:'direct'};
   const candidate=parseProductMarkdown(productMarkdown(page.text),binding.url);
   if(candidate)return {status:'ok',candidate,validators:page.validators,transport:'direct'};
  }catch(error){
   directFailure=error instanceof SourceFailure?error:new SourceFailure('error',error instanceof Error?error.message:'Источник недоступен');
   // A blocked page may need the saved-URL scraper; transient failures wait for their next retry.
   if(!/HTTP 403$/.test(directFailure.message)||!options.firecrawlKey)throw directFailure;
  }
  if(options.firecrawlKey){
   const data=await scrapeSaved();
   if(typeof data.markdown!=='string')throw new SourceFailure('error','Firecrawl не вернул содержимое страницы');
   const candidate=parseProductMarkdown(data.markdown,binding.url);
   if(candidate)return {status:'ok',candidate,validators:{},transport:'firecrawl'};
  }
  return directFailure?{status:directFailure.status,reason:directFailure.message}:{status:'invalid',reason:'Сохранённая страница не содержит полных подтверждённых КБЖУ на 100 г'};
 }catch(error){return {status:error instanceof SourceFailure?error.status:'error',reason:error instanceof Error?error.message:'Ошибка сохранённого источника'};}
}
