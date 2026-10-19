import type {Offer} from './domain.ts';
import type {CatalogListing} from './proshoper.ts';
import {classifyProduct,isExcludedProduct,enrichmentKey,enrichedOffer,type EnrichmentRecord} from './product-enrichment.ts';
import {mergeCatalogOffers,listingToOffer} from './catalog-sync.ts';
import {discoveryQueue,knownRefreshQueue} from './source-refresh.ts';
import {preferStorePrices} from './offer-selection.ts';
export const activeOffer=(o:Offer,now=new Date())=>!o.demo&&o.localConfirmed&&o.status==='confirmed'&&Date.parse(o.observedAt)<=now.getTime()&&Date.parse(o.validUntil)>now.getTime()&&(!o.validFrom||Date.parse(o.validFrom)<=now.getTime());
export function enrichmentQueue(listings:CatalogListing[],records:EnrichmentRecord[],offers:Offer[],now=new Date()):CatalogListing[]{
  return discoveryQueue(listings,records,offers,now);
}
export function reconcileEnrichedOffers(offers:Offer[],listings:CatalogListing[],records:EnrichmentRecord[],now=new Date()):Offer[]{
  const cache=new Map(records.map(r=>[r.key,r]));const incoming=listings.flatMap(row=>{const r=cache.get(enrichmentKey(row));const o=r?enrichedOffer(row,r,now):null;return o?[o]:[];});
  const incomingSources=new Set(incoming.map(o=>o.sourceUrl+'|'+o.storeId));
  const listingSources=new Set(listings.map(r=>r.sourceUrl+'|'+r.storeId));
  const bySource=new Map(listings.map(r=>[r.sourceUrl+'|'+r.storeId,r]));
  const excludedKeys=new Set(records.filter(r=>r.userExcluded).map(r=>r.key));
  const excludedSources=new Set(listings.filter(r=>excludedKeys.has(enrichmentKey(r))).map(r=>r.sourceUrl+'|'+r.storeId));
  const checked=offers.map(o=>{
    // Exclusion is an explicit owner decision and also applies to a previously
    // canonical or manually entered price for the same local product card.
    if(excludedSources.has(o.sourceUrl+'|'+o.storeId)||excludedKeys.has(o.foodId.replace(/^e-/,''))||excludedKeys.has(enrichmentKey({name:o.name,packGrams:o.packGrams})))return {...o,status:'pending' as const};
    if(o.verification!=='catalog')return o;
    const key=o.sourceUrl+'|'+o.storeId;
    if(o.foodId.startsWith('e-'))return listingSources.has(key)&&!incomingSources.has(key)?{...o,status:'pending' as const}:o;
    const listing=bySource.get(key);if(!listing)return o;
    const normalized=listingToOffer(listing,now);
    return !normalized||normalized.foodId!==o.foodId?{...o,status:'pending' as const}:o;
  });
  return mergeCatalogOffers(checked,incoming.filter(o=>!excludedSources.has(o.sourceUrl+'|'+o.storeId)));
}
export function enrichmentSummary(listings:CatalogListing[],records:EnrichmentRecord[],offers:Offer[],now=new Date()){
  const excludedKeys=new Set(records.filter(r=>r.userExcluded).map(r=>r.key));
  const active=preferStorePrices(offers.filter(o=>activeOffer(o,now)),now);const eligible=listings.filter(r=>!excludedKeys.has(enrichmentKey(r))&&classifyProduct(r.name));
  const searchable=listings.filter(r=>!excludedKeys.has(enrichmentKey(r))&&!isExcludedProduct(r.name));const keys=new Set(searchable.map(enrichmentKey));const relevant=records.filter(r=>keys.has(r.key));
  const matchedKeys=new Set(relevant.filter(r=>r.status==='matched').map(r=>r.key));
  return {listings:listings.length,menuReady:active.length,withExternalNutrition:active.filter(o=>o.nutritionSourceUrl).length,referenceNutrition:active.filter(o=>!o.nutritionSourceUrl).length,unclassified:searchable.filter(r=>!classifyProduct(r.name)&&!matchedKeys.has(enrichmentKey(r))).length,excluded:listings.length-searchable.length,classified:eligible.length,uniqueProducts:keys.size,checked:relevant.length,matched:relevant.filter(r=>r.status==='matched').length,ambiguous:relevant.filter(r=>r.status==='ambiguous').length,notFound:relevant.filter(r=>r.status==='not-found').length,errors:relevant.filter(r=>r.status==='error').length,pending:discoveryQueue(listings,records,offers,now).length,knownDue:knownRefreshQueue(listings,records,now).length,sourceTracked:relevant.filter(r=>r.sourceRefresh).length,sourceStale:relevant.filter(r=>r.sourceRefresh&&r.sourceRefresh.status!=='current').length,sourceChanges:relevant.filter(r=>r.sourceRefresh?.changes.length).length,missingQuantity:searchable.filter(r=>!r.packGrams&&r.priceUnit!=='kg').length,unavailable:searchable.filter(r=>!['listed','in-stock'].includes(r.availability)).length};
}
export type EnrichmentSummary=ReturnType<typeof enrichmentSummary>;
