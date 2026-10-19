import {apiKey} from './providers';
import {acquireLease,releaseLease,readState,mutateState,type UserState} from './state';
import type {CatalogListing} from '../proshoper';
import {validBarcode,parseNutrition} from '../nutrition';
import {enrichmentKey,matchProduct,parseMass,type ProductCandidate,type EnrichmentRecord} from '../product-enrichment';
import {enrichmentQueue,enrichmentSummary,reconcileEnrichedOffers} from '../enrichment';
import {allowedProductUrl,parseProductMarkdown,PRODUCT_HOSTS,searchWords} from '../enrichment-sources';

const UA='Edada/0.3 (+https://eda-da-kogalym.social-grape-1472.chatgpt.site)';
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
async function limitedJson(url:string,scope:string,gap:number,init:RequestInit={},deadline=Date.now()+30000):Promise<any>{
  const rateKey=scope==='off-product'?'nutrition:openfoodfacts':'enrich:rate:'+scope;
  while(!await acquireLease(rateKey,gap)){
    if(Date.now()+gap*1000>deadline)throw new Error('Лимит частоты источника; поиск продолжится позже');
    await pause(Math.min(gap*1000,3000));
  }
  const response=await fetch(url,{...init,headers:{'User-Agent':UA,...init.headers},signal:AbortSignal.timeout(Math.max(1000,Math.min(22000,deadline-Date.now()))),redirect:'manual'});
  if(!response.ok)throw new Error(`${scope}: HTTP ${response.status}${response.status===429?' — очередь повторит запрос позже':''}`);
  return response.json();
}
async function offCandidates(row:CatalogListing,deadline:number):Promise<ProductCandidate[]>{
  const words=searchWords(row.name).split(/\s+/).filter(w=>w.length>1).slice(0,9);
  const q=words.map(w=>'"'+w.replace(/["\\]/g,'')+'"').join(' AND ');
  const params=new URLSearchParams({q,langs:'ru,en',page_size:'5',fields:'code,product_name,brands,quantity'});
  const search=await limitedJson('https://search.openfoodfacts.org/search?'+params,'off-search',6,{},deadline);
  if(search.timed_out)throw new Error('Open Food Facts: поиск превысил время ожидания');
  const candidates:ProductCandidate[]=[];
  const errors:string[]=[];
  for(const hit of (Array.isArray(search.hits)?search.hits:[]).slice(0,2)){
    const code=String(hit.code??'');if(!validBarcode(code))continue;
    let detail:any;
    try{detail=await limitedJson(`https://world.openfoodfacts.org/api/v3.6/product/${code}.json?fields=code,product_name,brands,quantity,nutrition,nutriments`,'off-product',5,{},deadline);}
    catch(e){errors.push(e instanceof Error?e.message:'Open Food Facts недоступен');continue;}
    try{
      const c=parseNutrition(detail,code);candidates.push({productName:c.productName,brand:c.brand,barcode:c.code,quantityText:c.quantity,packGrams:parseMass(c.quantity),macros:c.macros,sourceUrl:c.sourceUrl,nutritionSourceUrl:c.sourceUrl,quantitySourceUrl:c.quantity?c.sourceUrl:undefined,observedAt:c.observedAt,estimated:c.estimated,evidence:`Open Food Facts: ${c.productName}; ${c.quantity}; полные значения на 100 г, as_sold.`});
      if(matchProduct(row,candidates).status==='matched')break;
    }catch{/* Incomplete, prepared and 100ml records are not nutrition matches. */}
  }
  if(!candidates.length&&errors.length)throw new Error(errors.join('; ').slice(0,300));
  return candidates;
}
async function firecrawlCandidates(row:CatalogListing,key:string,deadline:number):Promise<ProductCandidate[]>{
  const options={method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`}};
  const search=await limitedJson('https://api.firecrawl.dev/v2/search','firecrawl-search',6,{...options,body:JSON.stringify({query:row.name.slice(0,280)+' пищевая ценность',sources:['web'],includeDomains:PRODUCT_HOSTS,limit:3})},deadline);
  if(search.success===false)throw new Error('Firecrawl не подтвердил поиск');
  const pages=Array.isArray(search.data?.web)?search.data.web:Array.isArray(search.data)?search.data:[];
  const candidates:ProductCandidate[]=[];
  const errors:string[]=[];
  for(const page of pages.slice(0,3)){
    if(Date.now()+5000>deadline)break;
    if(!allowedProductUrl(page.url))continue;
    try{
      const data=await limitedJson('https://api.firecrawl.dev/v2/scrape','firecrawl-scrape',6,{...options,body:JSON.stringify({url:page.url,maxAge:0,onlyMainContent:true,formats:['markdown'],timeout:18000})},deadline);
      if(data.success===false||!data.data?.markdown||Number(data.data?.metadata?.statusCode??200)!==200){errors.push('Страница '+new URL(page.url).hostname+' не подтвердила данные');continue;}
      const candidate=parseProductMarkdown(data.data.markdown,page.url);if(candidate)candidates.push(candidate);
      if(matchProduct(row,candidates).status==='matched')break;
    }catch(e){errors.push(e instanceof Error?e.message:'Страница недоступна');}
  }
  if(!candidates.length&&errors.length)throw new Error(errors.join('; ').slice(0,300));
  return candidates;
}
export async function lookupProduct(row:CatalogListing,state:UserState,deadline:number):Promise<ReturnType<typeof matchProduct>>{
  let candidates:ProductCandidate[]=[];const errors:string[]=[];
  try{candidates=await offCandidates(row,deadline);}catch(e){errors.push(e instanceof Error?e.message:'OFF недоступен');}
  const off=matchProduct(row,candidates);if(off.status==='matched')return off;
  const key=await apiKey(state,'firecrawl');
  if(key&&Date.now()+5000<deadline){try{candidates.push(...await firecrawlCandidates(row,key,deadline));}catch(e){errors.push(e instanceof Error?e.message:'Firecrawl недоступен');}}
  const result=matchProduct(row,candidates);
  if(result.status==='not-found'&&errors.length)throw new Error(errors.join('; ').slice(0,350));
  if(result.status==='not-found'&&!key)result.reason+=' Проверен Open Food Facts. Для поиска по сайтам добавьте серверный ключ Firecrawl в настройках.';
  return result;
}
export async function enrichBatch(owner:string,limit=6,budgetMs=85000){
  const lock=`enrichment:${owner}`;if(!await acquireLease(lock,120))return {busy:true,message:'Автоматический поиск уже выполняется. Прогресс сохранён.'};
  try{
    const state=await readState(owner);if(state.enrichmentEnabled===false)return {disabled:true,message:'Автоматическое обогащение выключено'};
    const provider=await apiKey(state,'firecrawl')?'off+web' as const:'off' as const;
    const queue=enrichmentQueue(state.listings??[],state.enrichment??[],state.offers).slice(0,Math.max(1,Math.min(20,limit)));
    let checked=0,matched=0;const deadline=Date.now()+Math.min(95000,Math.max(5000,budgetMs));
    for(const row of queue){
      if(Date.now()+3000>deadline)break;
      const started=new Date(),key=enrichmentKey(row);const old=state.enrichment?.find(r=>r.key===key);let record:EnrichmentRecord;
      try{const result=await lookupProduct(row,state,deadline);record={key,listingName:row.name,...result,checkedAt:started.toISOString(),retryAt:new Date(started.getTime()+(result.status==='matched'?30:7)*86400000).toISOString(),attempts:(old?.attempts??0)+1};}
      catch(e){record={key,listingName:row.name,status:'error',reason:e instanceof Error?e.message:'Ошибка внешнего источника',checkedAt:started.toISOString(),retryAt:new Date(started.getTime()+3600000).toISOString(),attempts:(old?.attempts??0)+1};if(old?.status==='matched')record={...record,status:'matched',candidate:old.candidate,reason:'Характеристики сохранены; повторная проверка: '+record.reason};}
      record.provider=provider;
      await mutateState(owner,s=>{
        // The listing may have changed while an external source was loading.
        if(!(s.listings??[]).some(r=>enrichmentKey(r)===key))return;
        const newer=s.enrichment?.find(r=>r.key===key);if(newer&&Date.parse(newer.checkedAt)>Date.parse(record.checkedAt))return;
        s.enrichment=[record,...(s.enrichment??[]).filter(r=>r.key!==key)].slice(0,5000);
        s.offers=reconcileEnrichedOffers(s.offers,s.listings??[],s.enrichment);
        s.enrichmentMessage=`Проверяется автоматически: ${row.name}. ${record.reason}`;
      });checked++;if(record.status==='matched')matched++;
    }
    const current=await readState(owner);const summary=enrichmentSummary(current.listings??[],current.enrichment??[],current.offers);
    const message=`Проверено товаров: ${checked}; точных совпадений: ${matched}. В очереди: ${summary.pending}. Результаты сохранены; поиск продолжится с оставшихся товаров.`;
    await mutateState(owner,s=>{s.enrichmentMessage=message;});return {checked,matched,summary,message};
  }finally{await releaseLease(lock);}
}
