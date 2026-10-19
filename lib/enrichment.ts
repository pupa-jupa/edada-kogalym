import type {Offer} from './domain.ts';
import type {CatalogListing} from './proshoper.ts';
import {classifyProduct,enrichmentKey,enrichedOffer,type EnrichmentRecord} from './product-enrichment.ts';
import {mergeCatalogOffers,listingToOffer} from './catalog-sync.ts';
export const activeOffer=(o:Offer,now=new Date())=>!o.demo&&o.localConfirmed&&o.status==='confirmed'&&Date.parse(o.observedAt)<=now.getTime()&&Date.parse(o.validUntil)>now.getTime()&&(!o.validFrom||Date.parse(o.validFrom)<=now.getTime());
export function enrichmentQueue(listings:CatalogListing[],records:EnrichmentRecord[],offers:Offer[],now=new Date()):CatalogListing[]{
  const cache=new Map(records.map(r=>[r.key,r]));const unique=new Map<string,CatalogListing>();
  for(const row of listings){
    if(!row.price||!['listed','in-stock'].includes(row.availability)||!classifyProduct(row.name))continue;
    const record=cache.get(enrichmentKey(row));if(record&&Date.parse(record.retryAt)>now.getTime())continue;
    if(!unique.has(enrichmentKey(row)))unique.set(enrichmentKey(row),row);
  }
  const score=(row:CatalogListing)=>{
    const kind=classifyProduct(row.name)?.kind??'';
    return (offers.some(o=>o.sourceUrl===row.sourceUrl&&activeOffer(o,now))?0:100)+(/curd|yogurt|cheese|canned|raw|ready-meat/.test(kind)?30:0)+(row.packGrams?10:0)-(cache.get(enrichmentKey(row))?.attempts??0)*200;
  };
  return [...unique.values()].sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name,'ru'));
}
export function reconcileEnrichedOffers(offers:Offer[],listings:CatalogListing[],records:EnrichmentRecord[],now=new Date()):Offer[]{
  const cache=new Map(records.map(r=>[r.key,r]));const incoming=listings.flatMap(row=>{const r=cache.get(enrichmentKey(row));const o=r?enrichedOffer(row,r,now):null;return o?[o]:[];});
  const incomingSources=new Set(incoming.map(o=>o.sourceUrl+'|'+o.storeId));
  const listingSources=new Set(listings.map(r=>r.sourceUrl+'|'+r.storeId));
  const bySource=new Map(listings.map(r=>[r.sourceUrl+'|'+r.storeId,r]));
  const checked=offers.map(o=>{
    if(o.verification!=='catalog')return o;
    const key=o.sourceUrl+'|'+o.storeId;
    if(o.foodId.startsWith('e-'))return listingSources.has(key)&&!incomingSources.has(key)?{...o,status:'pending' as const}:o;
    const listing=bySource.get(key);if(!listing)return o;
    const normalized=listingToOffer(listing,now);
    return !normalized||normalized.foodId!==o.foodId?{...o,status:'pending' as const}:o;
  });
  return mergeCatalogOffers(checked,incoming);
}
export function enrichmentSummary(listings:CatalogListing[],records:EnrichmentRecord[],offers:Offer[],now=new Date()){
  const active=offers.filter(o=>activeOffer(o,now));const eligible=listings.filter(r=>classifyProduct(r.name));
  const keys=new Set(eligible.map(enrichmentKey));const relevant=records.filter(r=>keys.has(r.key));
  return {listings:listings.length,menuReady:active.length,withExternalNutrition:active.filter(o=>o.nutritionSourceUrl).length,referenceNutrition:active.filter(o=>!o.nutritionSourceUrl).length,unclassified:listings.length-eligible.length,classified:eligible.length,uniqueProducts:keys.size,checked:relevant.length,matched:relevant.filter(r=>r.status==='matched').length,ambiguous:relevant.filter(r=>r.status==='ambiguous').length,notFound:relevant.filter(r=>r.status==='not-found').length,errors:relevant.filter(r=>r.status==='error').length,pending:enrichmentQueue(listings,records,offers,now).length,missingQuantity:eligible.filter(r=>!r.packGrams&&r.priceUnit!=='kg').length,unavailable:eligible.filter(r=>!['listed','in-stock'].includes(r.availability)).length};
}
export type EnrichmentSummary=ReturnType<typeof enrichmentSummary>;
