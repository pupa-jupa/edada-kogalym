import {database,readState,mutateState,acquireLease,releaseLease} from './state';
import {enrichmentKey,isExcludedProduct,matchProduct,type ProductCandidate} from '../product-enrichment';
import {enrichmentQueue,enrichmentSummary,reconcileEnrichedOffers} from '../enrichment';
import {bulkCatalogSignature,bulkProgress,mapWithinBudget,mergeBulkRecords,type BulkResult,type RetailerBulkJob} from '../bulk-enrichment';
import {parseMagnitSitemap,retailerTargets,type MagnitProduct} from '../retailer-index';
import {parseMagnitProduct,parseMagnitHtml} from '../retailer-reference';
const DAY=86400000;
class SourceThrottleError extends Error {}
const headers={'User-Agent':'Mozilla/5.0 (compatible; Edada/0.4)','Content-Type':'application/json','x-platform':'Web','x-magnit-bff':'1'};
export async function seedRetailerReferences(entries:Array<{sourceUrl:string;candidate:ProductCandidate|null;observedAt:string}>){
 const statements=entries.map(entry=>{
  const u=new URL(entry.sourceUrl),id=u.pathname.match(/^\/product\/(\d+)(?:-|$)/)?.[1];
  if(u.origin!=='https://magnit.ru'||!id||!Number.isFinite(Date.parse(entry.observedAt))||Date.parse(entry.observedAt)>Date.now()+60000)throw new Error('Недопустимая карточка справочника');
  if(entry.candidate&&(entry.candidate.sourceUrl!==entry.sourceUrl||entry.candidate.nutritionSourceUrl!==entry.sourceUrl))throw new Error('Источник характеристик не совпадает с карточкой');
  const expires=Date.parse(entry.observedAt)+(entry.candidate?7*DAY:DAY);
  return database().prepare('INSERT INTO reference_cache (id,payload,expires_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at WHERE excluded.expires_at>reference_cache.expires_at').bind('magnit-product:'+id,JSON.stringify({candidate:entry.candidate}),expires);
 });if(statements.length)await database().batch(statements);return {cached:statements.length};
}
async function cached<T>(id:string):Promise<T|undefined>{const row=await database().prepare('SELECT payload FROM reference_cache WHERE id=? AND expires_at>?').bind(id,Date.now()).first<{payload:string}>();return row?JSON.parse(row.payload) as T:undefined;}
async function put(id:string,payload:unknown,ttl:number){await database().prepare('INSERT INTO reference_cache (id,payload,expires_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at').bind(id,JSON.stringify(payload),Date.now()+ttl).run();}
async function sitemap():Promise<MagnitProduct[]>{
 const meta=await cached<{parts:number}>('magnit-sitemap:meta');
 if(meta){const parts=await Promise.all(Array.from({length:meta.parts},(_,i)=>cached<MagnitProduct[]>('magnit-sitemap:part:'+i)));if(parts.every(Boolean))return parts.flatMap(p=>p!);}
 const response=await fetch('https://magnit.ru/__sitemap__/products.xml',{headers,redirect:'manual',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Карта товаров: HTTP '+response.status);
 const text=await response.text();if(text.length>10000000)throw new Error('Карта товаров превысила ограничение размера');
 const products=parseMagnitSitemap(text);if(products.length<100)throw new Error('Карта товаров не подтвердила ассортимент');
 const chunks:Array<MagnitProduct[]>=[];for(let i=0;i<products.length;i+=1000)chunks.push(products.slice(i,i+1000));
 await database().batch(chunks.map((p,i)=>database().prepare('INSERT INTO reference_cache (id,payload,expires_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at').bind('magnit-sitemap:part:'+i,JSON.stringify(p),Date.now()+DAY)));
 await put('magnit-sitemap:meta',{parts:chunks.length},DAY);return products;
}
async function reference(url:string,deadline:number):Promise<ProductCandidate|null>{
 const id=new URL(url).pathname.match(/^\/product\/(\d+)/)?.[1];if(!id||new URL(url).origin!=='https://magnit.ru')throw new Error('Недопустимая ссылка справочника');
 const key='magnit-product:'+id,known=await cached<{candidate:ProductCandidate|null}>(key);if(known)return known.candidate;
 const timeout=()=>AbortSignal.timeout(Math.max(1000,Math.min(10000,deadline-Date.now())));
 let candidate:ProductCandidate|null=null;let error='';
 try{const response=await fetch(`https://magnit.ru/webgate/v2/goods/${id}/stores/992301?storetype=dostavka&catalogtype=3`,{headers,redirect:'manual',signal:timeout()});if(response.status===429)throw new SourceThrottleError('Источник ограничил частоту: HTTP 429');if(!response.ok)throw new Error('Карточка: HTTP '+response.status);candidate=parseMagnitProduct(await response.json(),url);}catch(e){if(e instanceof SourceThrottleError)throw e;error=e instanceof Error?e.message:'Сбой источника';}
 if(!candidate){if(Date.now()+2500>=deadline)throw new Error('Недостаточно времени для проверки страницы; результат не кэширован');try{const response=await fetch(url,{headers,redirect:'manual',signal:timeout()});if(response.status===429)throw new SourceThrottleError('Источник ограничил частоту: HTTP 429');if(!response.ok)throw new Error('Страница: HTTP '+response.status);candidate=parseMagnitHtml(await response.text(),url);error='';}catch(e){if(e instanceof SourceThrottleError)throw e;error=e instanceof Error?e.message:'Сбой страницы';}}
 if(error)throw new Error(error);
 await put(key,{candidate},candidate?7*DAY:DAY);return candidate;
}
/** A resumable broad pass. Missing retailer facts remain eligible for OFF/web fallback. */
export async function enrichRetailerIndex(owner:string,limit=50,budgetMs=85000){
 const lock='enrichment:'+owner;if(!await acquireLease(lock,120))return {busy:true,message:'Проверка уже выполняется; прогресс сохранён.'};
 try{
  const cooldown=await database().prepare('SELECT expires_at FROM refresh_leases WHERE id=?').bind('enrichment:retailer-cooldown').first<{expires_at:number}>();if(cooldown&&cooldown.expires_at>Date.now())return {cooldown:true,message:'Источник ограничил частоту. Повторная проверка после '+new Date(cooldown.expires_at).toISOString()};
  const state=await readState(owner);if(state.enrichmentEnabled===false)return {disabled:true};
  const started=new Date(),deadline=Date.now()+Math.min(95000,budgetMs);
  const searchable=(state.listings??[]).filter(r=>!!r.price&&['listed','in-stock'].includes(r.availability)&&!isExcludedProduct(r.name));
  const signature=bulkCatalogSignature(searchable);let job:RetailerBulkJob|undefined=state.retailerBulk;
  if(!job||job.signature!==signature||job.completedAt&&Date.now()-Date.parse(job.completedAt)>7*DAY){
   const products=await sitemap();const remaining=enrichmentQueue(state.listings??[],state.enrichment??[],state.offers);
   job={signature,startedAt:started.toISOString(),targets:retailerTargets(remaining,products),cursor:0,matched:0,errors:0,referenceProducts:products.length};
   await mutateState(owner,s=>{s.retailerBulk=job;});
  }
  if(job.completedAt)return {complete:true,bulk:bulkProgress(job),summary:enrichmentSummary(state.listings??[],state.enrichment??[],state.offers)};
  const byKey=new Map(searchable.map(row=>[enrichmentKey(row),row]));
  const tasks=job.targets.slice(job.cursor,job.cursor+Math.max(1,Math.min(100,limit)));
  const inFlight=new Map<string,Promise<ProductCandidate|null>>();let throttled=false;
  const results=await mapWithinBudget(tasks,3,deadline-12000,async target=>{
   const row=byKey.get(target.key);if(!row)return null;const candidates:ProductCandidate[]=[];const errors:string[]=[];
   for(const url of target.urls){if(throttled)throw new SourceThrottleError('Источник ограничил частоту: HTTP 429');if(Date.now()+1500>deadline){errors.push('Проверка продолжится после ограничения времени');break;}
    try{let pending=inFlight.get(url);if(!pending){pending=reference(url,deadline);inFlight.set(url,pending);}const candidate=await pending;if(candidate)candidates.push(candidate);}catch(e){if(e instanceof SourceThrottleError){throttled=true;await acquireLease('enrichment:retailer-cooldown',60);throw e;}errors.push(e instanceof Error?e.message:'Сбой источника');}
   }
   const result=matchProduct(row,candidates);
   if(result.status==='not-found')result.reason=errors.length?'Ошибка массового источника: '+errors.join('; ').slice(0,250):'В индексе Магнита нет полного точного совпадения. Индивидуальный поиск по другим источникам остаётся в очереди.';
   return {row,result:result.status==='not-found'&&errors.length?{status:'error' as const,reason:result.reason}:result} satisfies BulkResult;
  });
  const completed=results.filter((r):r is BulkResult=>r!==null);
  const cursor=job.cursor+results.length,matched=completed.filter(r=>r.result.status==='matched').length,errors=completed.filter(r=>r.result.status==='error').length;
  const current=await mutateState(owner,s=>{
   const stillCurrent=new Set((s.listings??[]).map(enrichmentKey));s.enrichment=mergeBulkRecords(s.enrichment??[],completed.filter(r=>stillCurrent.has(enrichmentKey(r.row))),started);s.offers=reconcileEnrichedOffers(s.offers,s.listings??[],s.enrichment);
   if(s.retailerBulk?.signature===signature){s.retailerBulk={...job!,cursor,matched:job!.matched+matched,errors:job!.errors+errors,...(cursor>=job!.targets.length?{completedAt:new Date().toISOString()}:{} )};}
   s.enrichmentMessage=`Массовая проверка: ${cursor} из ${job!.targets.length}; точных совпадений: ${job!.matched+matched}. Недостающие данные ищутся отдельно по другим источникам.`;
  });
  return {checked:results.length,matched,complete:!!current.retailerBulk?.completedAt,bulk:bulkProgress(current.retailerBulk),summary:enrichmentSummary(current.listings??[],current.enrichment??[],current.offers),message:current.enrichmentMessage};
 }finally{await releaseLease(lock);}
}
