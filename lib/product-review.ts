import {z} from 'zod';
import type {Offer} from './domain.ts';
import type {CatalogListing} from './proshoper.ts';
import {REVIEW_KINDS,classifyProduct,enrichedFood,enrichmentKey,isExcludedProduct,parseMass,type EnrichmentRecord,type ProductCandidate} from './product-enrichment.ts';
import {macrosSchema,validateSourceUrl} from './validation.ts';
import {reconcileEnrichedOffers} from './enrichment.ts';
import {foodIdentity,type GenerationAttempt} from './recipe-library.ts';
export {REVIEW_KINDS} from './product-enrichment.ts';
export type ReviewTask={key:string;fingerprint:string;name:string;storeId:string;sourceUrl:string;reason:string;issue:'nutrition'|'mass'|'role'|'nonfood';packGrams?:number;candidate?:ProductCandidate;kind?:string};
export type ReviewLedgerEntry={action:'confirm'|'exclude'|'skip'|'undo';at:string;fingerprint:string;commandSignature?:string;awardedXp?:number;awardedAt?:string;previous?:EnrichmentRecord;appliedRecord?:EnrichmentRecord;skipUntil?:string;retiredOffers?:Array<{before:Offer;after:Offer}>};
export type ReviewLedger={entries:Record<string,ReviewLedgerEntry>};
export type ReviewView={stats:{xp:number;level:number;verified:number;excluded:number;dailyDone:number;dailyGoal:5;badges:string[]};tasks:ReviewTask[];remaining:number};
const publicUrl=z.string().max(2000).refine(value=>{try{validateSourceUrl(value);return true;}catch{return false;}},'Нужна публичная HTTPS-ссылка на этикетку или страницу продукта');
const reviewKind=z.enum(REVIEW_KINDS.map(k=>k.value) as [typeof REVIEW_KINDS[number]['value'],...typeof REVIEW_KINDS[number]['value'][]]);
export const reviewCommandSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('confirm'),key:z.string().min(1).max(100),fingerprint:z.string().min(1).max(100),kind:reviewKind,packGrams:z.number().finite().positive().max(20000),macros:macrosSchema,nutritionSourceUrl:publicUrl,labelEvidence:z.string().trim().min(12).max(1500),confirmed:z.literal(true)}),
 z.object({operation:z.literal('skip'),key:z.string().min(1).max(100),fingerprint:z.string().min(1).max(100).optional()}),
 z.object({operation:z.literal('exclude'),key:z.string().min(1).max(100),fingerprint:z.string().min(1).max(100).optional()}),
 z.object({operation:z.literal('undo'),key:z.string().min(1).max(100),fingerprint:z.string().min(1).max(100).optional()}),
]);
export type ReviewCommand=z.infer<typeof reviewCommandSchema>;
// Object key ordering must not make an unchanged persisted record appear stale.
function stable(value:unknown):string{
 if(value===undefined)return 'null';
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
 return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}
function digest(value:unknown):string{
 const facts=stable(value);
 let a=2166136261,b=5381;for(const ch of facts){a=Math.imul(a^ch.charCodeAt(0),16777619);b=Math.imul(b,33)^ch.charCodeAt(0);}return `review-${(a>>>0).toString(36)}${(b>>>0).toString(36)}`;
}
function fingerprint(row:CatalogListing,record?:EnrichmentRecord):string{return digest({key:enrichmentKey(row),name:row.name,packGrams:row.packGrams,packText:row.packText,barcode:row.barcode,brand:row.brand,record});}
function mass(row:CatalogListing):number|undefined{return row.packGrams??parseMass(row.packText??'')??parseMass(row.name);}
function day(date:Date):string{return new Date(date.getTime()+5*3600000).toISOString().slice(0,10);}
export function productReviewView(listings:CatalogListing[],records:EnrichmentRecord[],offers:Offer[],ledger:ReviewLedger={entries:{}},now=new Date(),generationAttempts:GenerationAttempt[]=[]):ReviewView{
 const byKey=new Map(records.map(r=>[r.key,r])),seen=new Set<string>();
 const tasks:ReviewTask[]=[];
 for(const row of listings){
  const key=enrichmentKey(row);if(seen.has(key))continue;seen.add(key);
  const record=byKey.get(key),entry=ledger.entries?.[key];
  const candidate=record?.candidate,food=candidate?enrichedFood(row,candidate):null;
  const latestAttempt=food?generationAttempts.filter(a=>a.foodId===food.id&&a.identity===foodIdentity(food)).sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0]:undefined;
  const needsReview=latestAttempt?.status==='needs-review';
  if(record?.userExcluded||record?.candidate?.userVerified&&!needsReview||(entry?.action==='skip'&&Date.parse(entry.skipUntil??'')>now.getTime()))continue;
  const kind=food?.kind??classifyProduct(row.name)?.kind,grams=mass(row)??candidate?.packGrams;
  const hasMacros=macrosSchema.safeParse(candidate?.macros).success;
  const issue:ReviewTask['issue']=needsReview?'role':isExcludedProduct(row.name)?'nonfood':!hasMacros?'nutrition':grams===undefined?'mass':!kind?'role':'nutrition';
  if(!needsReview&&kind&&hasMacros&&grams!==undefined&&(food||offers.some(o=>o.foodId===`e-${key}`)))continue;
  const reason=needsReview?latestAttempt.reason:issue==='nonfood'?'Проверьте: возможно, это не пищевой продукт.':issue==='mass'?'Нет подтверждённой массы съедобного продукта.':issue==='role'?'Нужно выбрать кулинарную роль продукта.':'Нужны полные КБЖУ с этикетки на 100 г.';
  tasks.push({key,fingerprint:fingerprint(row,record),name:row.name,storeId:row.storeId,sourceUrl:row.sourceUrl,reason,issue,packGrams:grams,candidate,kind});
 }
 const rank={nutrition:0,mass:1,role:2,nonfood:3};tasks.sort((a,b)=>rank[a.issue]-rank[b.issue]);
 const entries=Object.values(ledger.entries??{}),xp=entries.reduce((total,e)=>total+(e.awardedXp??0),0),dailyDone=entries.filter(e=>e.awardedAt&&day(new Date(e.awardedAt))===day(now)).length;
 const verified=records.filter(r=>!r.userExcluded&&r.candidate?.userVerified).length,excluded=records.filter(r=>r.userExcluded).length;
 const badges:string[]=[];if(xp>0)badges.push('Первая проверка');if(verified>=5)badges.push('Знаток этикеток');if(dailyDone>=5)badges.push('Цель дня');
 const balanced:ReviewTask[]=[];
 for(const issue of ['nutrition','mass','role','nonfood'] as const)balanced.push(...tasks.filter(task=>task.issue===issue).slice(0,2));
 const selected=new Set(balanced.map(task=>task.key));
 balanced.push(...tasks.filter(task=>!selected.has(task.key)).slice(0,12-balanced.length));
 return {stats:{xp,level:1+Math.floor(xp/100),verified,excluded,dailyDone,dailyGoal:5,badges},tasks:balanced,remaining:tasks.length};
}

/** Preserve just the prices retired by this exclusion, so undo can restore them
 * across storage reloads without overwriting a later edit or recreating a deletion. */
export function applyProductReviewWithOffers(listings:CatalogListing[],records:EnrichmentRecord[],offers:Offer[],ledger:ReviewLedger|undefined,command:ReviewCommand,now=new Date()){
 const previousEntry=ledger?.entries[command.key];
 const result=applyProductReview(listings,records,ledger,command,now);
 const entry=result.ledger.entries[command.key];
 let updatedOffers=offers;
 if(command.operation==='undo'&&previousEntry?.action==='exclude'&&entry!==previousEntry){
  const snapshots=new Map(previousEntry.retiredOffers?.map(snapshot=>[snapshot.after.id,snapshot])??[]);
  updatedOffers=offers.map(offer=>{const snapshot=snapshots.get(offer.id);return snapshot&&stable(offer)===stable(snapshot.after)?snapshot.before:offer;});
 }
 const reconciled=reconcileEnrichedOffers(updatedOffers,listings,result.enrichment,now);
 if(command.operation==='exclude'&&entry!==previousEntry){
  const previouslyEligible=new Map(reconcileEnrichedOffers(offers,listings,records,now).map(offer=>[offer.id,offer]));
  const afterById=new Map(reconciled.map(offer=>[offer.id,offer]));
  entry.retiredOffers=offers.flatMap(before=>{const after=afterById.get(before.id);return before.status==='confirmed'&&previouslyEligible.get(before.id)?.status==='confirmed'&&after?.status==='pending'?[{before,after}]:[];});
 }
 return {...result,offers:reconciled};
}
export function applyProductReview(listings:CatalogListing[],records:EnrichmentRecord[],ledger:ReviewLedger|undefined,rawCommand:ReviewCommand,now=new Date()):{enrichment:EnrichmentRecord[];ledger:ReviewLedger;message:string}{
 const command=reviewCommandSchema.parse(rawCommand),entries={...(ledger?.entries??{})},previousEntry=entries[command.key];
 const row=listings.find(r=>enrichmentKey(r)===command.key);if(!row)throw new Error('Товар изменился или больше не доступен в каталоге. Обновите задания.');
 const index=records.findIndex(r=>r.key===command.key),record=index<0?undefined:records[index],enrichment=records.slice();
 if(command.operation==='undo'){
  if(!previousEntry||!['confirm','exclude','skip'].includes(previousEntry.action))return {enrichment,ledger:{entries},message:'Нет действия для отмены.'};
  if(previousEntry.action!=='skip'){
   if(stable(record)!==stable(previousEntry.appliedRecord))throw new Error('После проверки появились новые данные. Отмена не может их перезаписать.');
   if(previousEntry.previous){if(index<0)enrichment.push(previousEntry.previous);else enrichment[index]=previousEntry.previous;}else if(index>=0)enrichment.splice(index,1);
  }
  entries[command.key]={...previousEntry,action:'undo',at:now.toISOString(),skipUntil:undefined};
  return {enrichment,ledger:{entries},message:'Действие отменено. Очки повторно не начисляются.'};
 }
 // A network retry may carry the original fingerprint after its own write succeeded.
 if(previousEntry?.action===command.operation&&previousEntry.commandSignature===digest(command)&&stable(record)===stable(previousEntry.appliedRecord))return {enrichment,ledger:{entries},message:'Эта проверка уже сохранена.'};
 if(command.fingerprint!==fingerprint(row,record))throw new Error('Данные товара изменились. Обновите задание перед проверкой.');
 const entry:ReviewLedgerEntry={action:command.operation,at:now.toISOString(),fingerprint:command.fingerprint!,commandSignature:digest(command),awardedXp:previousEntry?.awardedXp,awardedAt:previousEntry?.awardedAt};
 if(command.operation==='skip'){
  const tomorrow=new Date(now.getTime()+5*3600000);tomorrow.setUTCHours(24,0,0,0);entry.skipUntil=new Date(tomorrow.getTime()-5*3600000).toISOString();entry.appliedRecord=record;
  entries[command.key]=entry;return {enrichment,ledger:{entries},message:'Отложено до завтра. Очки не потеряны.'};
 }
 let next:EnrichmentRecord;
 if(command.operation==='exclude'){
  next=record?{...record,userExcluded:true}:{key:command.key,listingName:row.name,status:'not-found',checkedAt:now.toISOString(),retryAt:now.toISOString(),attempts:0,reason:'Пользователь исключил товар из питания.',userExcluded:true};
 }else{
  if(isExcludedProduct(row.name))throw new Error('Это исключённый непищевой продукт. Его нельзя подтвердить для питания.');
  const known=mass(row);if(known!==undefined&&Math.abs(known-command.packGrams)>0.01)throw new Error('Масса отличается от известной фасовки товара.');
  const candidate:ProductCandidate={productName:row.name,packGrams:command.packGrams,quantityText:`${command.packGrams} г`,macros:{...command.macros},sourceUrl:command.nutritionSourceUrl,nutritionSourceUrl:command.nutritionSourceUrl,quantitySourceUrl:command.nutritionSourceUrl,observedAt:now.toISOString(),estimated:false,userVerified:true,reviewKind:command.kind,evidence:`Пользователь подтвердил точный товар и КБЖУ на 100 г. Масса съедобного продукта указана вручную. ${command.labelEvidence}`};
  if(!enrichedFood(row,candidate))throw new Error('Не удалось безопасно подтвердить данные продукта.');
  next={key:command.key,listingName:row.name,status:'matched',checkedAt:now.toISOString(),retryAt:new Date(now.getTime()+365*86400000).toISOString(),attempts:record?.attempts??0,reason:'Пользователь проверил этикетку, массу и кулинарную роль.',candidate};
 }
 entry.previous=record;entry.appliedRecord=next;
 if(entry.awardedXp===undefined){entry.awardedXp=command.operation==='confirm'?10:5;entry.awardedAt=now.toISOString();}
 entries[command.key]=entry;if(index<0)enrichment.push(next);else enrichment[index]=next;
 return {enrichment,ledger:{entries},message:command.operation==='confirm'?'Продукт проверен и доступен для меню.':'Товар исключён из питания.'};
}

