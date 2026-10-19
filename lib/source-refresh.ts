import type {Offer} from './domain.ts';
import type {CatalogListing} from './proshoper.ts';
import {classifyProduct,enrichmentKey,isExcludedProduct,matchProduct,preservePreparation,type EnrichmentRecord,type ProductCandidate} from './product-enrichment.ts';
import {bindingForCandidate,type KnownSourceBinding,type SourceValidators,type KnownSourceResult} from './known-product-fetch.ts';

export const SOURCE_PARSER_VERSION=1;
const DAY=86400000;
export type SourceFacts=Pick<ProductCandidate,'productName'|'brand'|'barcode'|'packGrams'|'macros'>;
export type SourceRefresh={
 binding:KnownSourceBinding;parserVersion:number;validators:SourceValidators;fingerprint:string;
 status:'current'|'stale'|'missing'|'invalid'|'conflict';lastCheckedAt:string;lastSuccessAt?:string;lastChangedAt:string;nextCheckAt:string;reason?:string;
 changes:Array<{at:string;fields:string[];before:SourceFacts;after:SourceFacts;sourceUrl?:string;previousSourceUrl?:string}>;discoveryRetryAt?:string;lastFacts?:SourceFacts;
};
/** Only extracted facts contribute: changing markup, timestamps and evidence are not product changes. */
export function sourceFacts(c:ProductCandidate):SourceFacts{
 const normalize=(s:string|undefined)=>s?.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
 return {productName:normalize(c.productName)!,brand:normalize(c.brand),barcode:c.barcode,packGrams:c.packGrams,macros:c.macros?{kcal:c.macros.kcal,protein:c.macros.protein,fat:c.macros.fat,carbs:c.macros.carbs}:undefined};
}
const fingerprint=(c:ProductCandidate)=>JSON.stringify(sourceFacts(c));
export const refreshSnapshot=(r:EnrichmentRecord)=>JSON.stringify([r.checkedAt,r.candidate,r.userExcluded,r.sourceRefresh]);
const eligible=(row:CatalogListing)=>!!row.price&&['listed','in-stock'].includes(row.availability)&&!isExcludedProduct(row.name);
export function knownRefreshQueue(listings:CatalogListing[],records:EnrichmentRecord[],now=new Date(),force=false){
 const byKey=new Map(records.map(r=>[r.key,r]));const seen=new Set<string>();
 return listings.filter(row=>{
  const key=enrichmentKey(row),r=byKey.get(key);if(seen.has(key)||!eligible(row)||r?.userExcluded||r?.status!=='matched'||!r.candidate||!bindingForCandidate(r.candidate))return false;
  if(!force&&r.sourceRefresh?.parserVersion===SOURCE_PARSER_VERSION&&Date.parse(r.sourceRefresh.nextCheckAt)>now.getTime())return false;
  seen.add(key);return true;
 }).sort((a,b)=>Date.parse(byKey.get(enrichmentKey(a))?.sourceRefresh?.lastCheckedAt??'1970-01-01')-Date.parse(byKey.get(enrichmentKey(b))?.sourceRefresh?.lastCheckedAt??'1970-01-01'));
}
/** Missing/invalid bindings are explicitly rediscovered. Transient outages never become name searches. */
export function discoveryQueue(listings:CatalogListing[],records:EnrichmentRecord[],offers:Offer[],now=new Date()):CatalogListing[]{
 const byKey=new Map(records.map(r=>[r.key,r]));const unique=new Map<string,CatalogListing>();
 for(const row of listings){
  const key=enrichmentKey(row),r=byKey.get(key);if(!eligible(row)||r?.userExcluded||r?.candidate?.userVerified)continue;
  const repair=r?.sourceRefresh&&['missing','invalid'].includes(r.sourceRefresh.status);
  if(r?.status==='matched'&&r.candidate&&bindingForCandidate(r.candidate)&&!repair)continue;
  if(r&&Date.parse(r.retryAt)>now.getTime()&&!repair&&(r.provider!=='retailer-index'||r.status==='matched'))continue;
  if(repair&&r.sourceRefresh?.discoveryRetryAt&&Date.parse(r.sourceRefresh.discoveryRetryAt)>now.getTime())continue;
  if(!unique.has(key))unique.set(key,row);
 }
 const score=(row:CatalogListing)=>{
  const kind=classifyProduct(row.name)?.kind??'';
  return (offers.some(o=>o.sourceUrl===row.sourceUrl&&!o.demo&&o.localConfirmed&&o.status==='confirmed'&&Date.parse(o.validUntil)>now.getTime())?0:100)+(kind?20:0)+(/curd|yogurt|cheese|canned|raw|ready-meat/.test(kind)?30:0)+(row.packGrams?10:0)-(byKey.get(enrichmentKey(row))?.attempts??0)*200;
 };
 return [...unique.values()].sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name,'ru'));
}
/** Compare against the exact snapshot loaded before I/O, including source rebindings and owner edits. */
export function applyKnownRefresh(row:CatalogListing,current:EnrichmentRecord,expected:string,result:KnownSourceResult,now=new Date()):EnrichmentRecord|undefined{
 if(current.userExcluded||refreshSnapshot(current)!==expected||current.key!==enrichmentKey(row)||!current.candidate)return;
 const binding=bindingForCandidate(current.candidate);if(!binding)return;
 const old=current.candidate,at=now.toISOString();
 const prior=JSON.stringify(current.sourceRefresh?.binding)===JSON.stringify(binding)?current.sourceRefresh:undefined;
 const refresh:SourceRefresh={validators:{},fingerprint:fingerprint(old),status:'current',lastChangedAt:old.observedAt,changes:[],...prior,binding,parserVersion:SOURCE_PARSER_VERSION,lastCheckedAt:at,nextCheckAt:new Date(now.getTime()+7*DAY).toISOString()};
 let candidate=old;
 if(result.status==='ok'){
  const incoming=result.candidate;
  const match=matchProduct(row,[incoming]);
  if(match.status!=='matched'||old.barcode&&incoming.barcode&&old.barcode!==incoming.barcode){
   refresh.status='invalid';refresh.reason='Источник больше не подтверждает тот же товар: '+match.reason;refresh.validators={};
  }else{
   const before=prior?.lastFacts??sourceFacts(old),after=sourceFacts(incoming);const changed=fingerprint(old)!==JSON.stringify(after);
   refresh.fingerprint=fingerprint(incoming);refresh.validators=result.validators;refresh.lastSuccessAt=at;
   refresh.lastFacts=after;
   refresh.status=old.userVerified&&changed?'conflict':'current';
   refresh.reason=refresh.status==='conflict'?'Источник изменился. Подтверждённые вами сведения сохранены.':undefined;
   if(JSON.stringify(before)!==JSON.stringify(after)){
    refresh.changes=[{at,fields:Object.keys(before).filter(k=>JSON.stringify(before[k as keyof SourceFacts])!==JSON.stringify(after[k as keyof SourceFacts])),before,after,sourceUrl:binding.url},...refresh.changes].slice(0,8);refresh.lastChangedAt=at;
   }
   if(!old.userVerified)candidate=incoming;
   delete refresh.discoveryRetryAt;
  }
 }else if(result.status==='unchanged'){
  refresh.validators=result.validators;refresh.lastSuccessAt=at;
  refresh.status=old.userVerified&&refresh.fingerprint!==fingerprint(old)?'conflict':'current';refresh.reason=refresh.status==='conflict'?'Источник отличается от подтверждённых вами сведений. Ваши данные сохранены.':undefined;
  if(!old.userVerified&&refresh.status==='current')candidate={...old,observedAt:at};
 }else{
  refresh.status=result.status==='error'?'stale':result.status;refresh.reason=result.reason;
  refresh.nextCheckAt=new Date(now.getTime()+(result.status==='error'?3600000:DAY)).toISOString();
  if(result.status!=='error')refresh.validators={};
 }
 if(refresh.status==='invalid'||refresh.status==='missing')refresh.nextCheckAt=new Date(now.getTime()+DAY).toISOString();
 const next={...current,candidate,checkedAt:at,retryAt:refresh.nextCheckAt,attempts:current.attempts+1,sourceRefresh:refresh};
 return preservePreparation(row,current,next);
}

/** Discovery binds a verified result once and retains history even when replacing a deleted source. */
export function trackDiscoveredSource(row:CatalogListing,current:EnrichmentRecord|undefined,next:EnrichmentRecord):EnrichmentRecord{
 if(next.status!=='matched'||!next.candidate)return next;
 const binding=bindingForCandidate(next.candidate);if(!binding)return next;
 const at=next.checkedAt,before=current?.sourceRefresh?.lastFacts??(current?.candidate?sourceFacts(current.candidate):undefined),after=sourceFacts(next.candidate);
 const previousBinding=current?.sourceRefresh?.binding??(current?.candidate?bindingForCandidate(current.candidate):undefined);
 const rebound=!!previousBinding&&JSON.stringify(previousBinding)!==JSON.stringify(binding);
 const fields=before?Object.keys(before).filter(k=>JSON.stringify(before[k as keyof SourceFacts])!==JSON.stringify(after[k as keyof SourceFacts])):[];
 if(rebound)fields.push('source');
 const changed=!!before&&fields.length>0;
 const prior=current?.sourceRefresh;
 const sourceRefresh:SourceRefresh={binding,parserVersion:SOURCE_PARSER_VERSION,validators:{},fingerprint:fingerprint(next.candidate),status:'current',lastCheckedAt:at,lastSuccessAt:at,lastChangedAt:changed?at:prior?.lastChangedAt??current?.candidate?.observedAt??next.candidate.observedAt,nextCheckAt:new Date(Date.parse(at)+7*DAY).toISOString(),lastFacts:after,changes:changed?[{at,fields,before:before!,after,sourceUrl:binding.url,previousSourceUrl:previousBinding?.url},...(prior?.changes??[])].slice(0,8):prior?.changes??[]};
 return preservePreparation(row,current,{...next,sourceRefresh,retryAt:sourceRefresh.nextCheckAt});
}
