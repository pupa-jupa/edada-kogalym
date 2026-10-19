import type {CatalogListing} from './proshoper.ts';
import type {Offer} from './domain.ts';
import {FOODS} from './catalog.ts';
import {validateOffer} from './validation.ts';
import {manufacturerNutrition} from './manufacturer-nutrition.ts';
// Conservative identity rules. Unmapped products remain visible as raw listings.
const rules:Array<[string,RegExp]>=[
  ['cottage-fatfree',/^(?:творог.*обезжир|обезжир[а-я]*\s+творог)/iu],
  ['cottage-grained',/^творог.*зерн[её]н.*5\s*%/iu],
  ['cottage',/^творог(?!.*зерн).*\b5\s*%/iu],
  ['pollock',/^(?:минтай.*филе|филе.*минта)/iu],['tuna',/^(?:тунец.*филе|филе.*тунц)/iu],
  ['chicken',/^(?:филе.*(?:курин|цыпл[её]н)|(?:курин|цыпл[её]н).*филе)/iu],
  ['turkey',/^(?:филе.*индей|индей.*филе)/iu],
  ['buckwheat',/^(?:гречка|крупа.*гречневая)/iu],['oats',/^(?:хлопья.*овсян|геркулес)/iu],
  ['rice',/^рис\s+(?!.*(?:бурый|смесь|готовый|хлебц))/iu],
  ['pasta',/^(?:макарон(?!.*лазан)|спагетти|рожки|вермишел)/iu],
  ['carrot',/^морковь\b/iu],['potato',/^картофель\b/iu],['cucumber',/^огурцы\b/iu],
];
export function listingToOffer(row:CatalogListing,now=new Date()):Offer|null {
  if(row.availability==='out-of-stock'||row.availability==='unknown'||!row.price||!row.packGrams||row.priceUnit!=='pack')return null;
  const normalized=row.name.toLocaleLowerCase('ru');
  if(/пюре|приправ|смесь\s+(?:сух[а-я]*\s+)?для|на\s+бумаге|на\s+второе|соус|сухарик|(?:^|[^а-я])фри(?:[^а-я]|$)|(?:об)?жарен|запеч[её]н|вар[её]н|с\s+(?:клубник|вишн|черник|малин|банан|персик|абрикос|изюм|шоколад|ванил)/iu.test(normalized))return null;
  if(/в кляре|паниров|копч[её]н|сол[её]ные|маринован|консерв|быстрого приготовления|каннелони|лазанья|пельмен|котлет|суп|бульон|по-корейски|с сыром|с соусом|готовое блюдо|запеканка/iu.test(normalized))return null;
  // JavaScript \b is ASCII-only; use explicit Cyrillic prefixes for produce.
  const foodId=/^морковь(?=[^а-я]|$)/u.test(normalized)?'carrot':/^картофель(?=[^а-я]|$)/u.test(normalized)?'potato':/^огурцы(?=[^а-я]|$)/u.test(normalized)?'cucumber':rules.find(([,r])=>r.test(row.name))?.[0];
  const food=FOODS.find(f=>f.id===foodId);if(!food)return null;
  if((foodId==='cottage'||foodId==='cottage-grained')&&!/(?:^|[^\d.,])5\s*%/.test(row.name))return null;
  const yieldFactor=foodId==='potato'?.85:foodId==='carrot'?.9:1;
  const promotion=(row.expiryKind??(row.validUntil?'promotion':'freshness'))==='promotion';
  try{return validateOffer({id:`auto-${row.id}`.slice(0,120),foodId,name:row.name,storeId:row.storeId,price:row.price,packGrams:Math.round(row.packGrams*yieldFactor),macros:food.macros,observedAt:row.observedAt,validFrom:row.validFrom,validUntil:row.validUntil??new Date(Date.parse(row.observedAt)+86400000).toISOString(),expiryKind:promotion?'promotion':'freshness',sourceUrl:row.sourceUrl,evidence:row.evidence,localEvidence:row.localEvidence,verification:'catalog',locality:row.locality??'city-catalog',localConfirmed:true,status:'confirmed',nutritionEstimated:true,demo:false,minPacks:1,priceCondition:row.priceCondition??'Цена городского каталога. Дополнительные условия покупки и остатки конкретной точки не подтверждены.',quantityNote:yieldFactor<1?`Фасовка ${row.packGrams} г. Съедобный выход после очистки оценён в ${yieldFactor*100}%; фактическую массу нужно взвесить.`:`Фасовка ${row.packText??row.packGrams+' г'} из названия товара. КБЖУ справочные; остатки не проверены.`},FOODS.map(f=>f.id),now);}catch{return null;}
}
export function selectCatalogRefresh(previous:CatalogListing[],incoming:CatalogListing[],sourceId:string,mode:'known'|'discover'){
  const ids=new Set(previous.filter(r=>r.sourceId===sourceId).map(r=>r.id));
  return {listings:mode==='discover'?incoming:incoming.filter(r=>ids.has(r.id)),discovered:mode==='discover'?incoming.filter(r=>!ids.has(r.id)).length:0};
}
const listingFacts=(r:CatalogListing)=>({name:r.name,price:r.price,packGrams:r.packGrams,priceUnit:r.priceUnit,availability:r.availability,validFrom:r.validFrom,validUntil:r.validUntil});
export function mergeListings(previous:CatalogListing[],incoming:CatalogListing[],sourceId:string,now=new Date()):CatalogListing[] {
  const byId=new Map(previous.map(r=>[r.id,r]));const seen=new Set(incoming.map(r=>r.id));
  for(const row of incoming){
    const old=byId.get(row.id);const changed=old&&JSON.stringify(listingFacts(old))!==JSON.stringify(listingFacts(row));
    const changes=changed?[{at:now.toISOString(),...listingFacts(old)},...(old.changes??[])].slice(0,8):old?.changes??[];
    byId.set(row.id,{...row,changes,lastChangedAt:changed?now.toISOString():old?.lastChangedAt??old?.observedAt??row.observedAt});
  }
  for(const [id,row] of byId)if(row.sourceId===sourceId&&!seen.has(id)&&row.availability!=='unknown')byId.set(id,{...row,availability:'unknown',lastChangedAt:now.toISOString(),changes:[{at:now.toISOString(),...listingFacts(row)},...(row.changes??[])].slice(0,8)});
  return [...byId.values()].slice(-5000);
}
export function mergeCatalogOffers(previous:Offer[],incoming:Offer[]):Offer[]{
  const result=[...previous];
  for(const input of incoming){
    const row=manufacturerNutrition(input);const i=result.findIndex(o=>o.sourceUrl===row.sourceUrl&&o.storeId===row.storeId);
    if(i<0){if(result.length<5000)result.push(row);continue;}
    const old=result[i];if(old.verification!=='catalog')continue;
    const sameProduct=old.name.trim().toLocaleLowerCase('ru')===row.name.trim().toLocaleLowerCase('ru')&&old.packGrams===row.packGrams;
    const preserveLabel=sameProduct&&!old.nutritionEstimated&&(!row.nutritionSourceUrl||Date.parse(old.nutritionObservedAt??'')>Date.parse(row.nutritionObservedAt??''));
    const nutrition=preserveLabel?{macros:old.macros,nutritionEstimated:false,nutritionSourceUrl:old.nutritionSourceUrl,nutritionProductName:old.nutritionProductName,nutritionObservedAt:old.nutritionObservedAt,barcode:old.barcode,brand:old.brand}:{nutritionSourceUrl:row.nutritionSourceUrl,nutritionProductName:row.nutritionProductName,nutritionObservedAt:row.nutritionObservedAt,barcode:row.barcode,brand:row.brand};
    result[i]={...old,...row,id:old.id,...nutrition};
  }
  return result;
}
export function reconcileCatalogOffers(previous:Offer[],listings:CatalogListing[],sourceUrl:string,now=new Date(),complete=true):Offer[]{
  const incoming=listings.flatMap(row=>{const offer=listingToOffer(row,now);return offer?[offer]:[];});const present=new Set(incoming.map(o=>o.sourceUrl+'|'+o.foodId));
  const observed=new Set(listings.map(row=>row.sourceUrl));
  const checked=previous.map(o=>o.verification==='catalog'&&(o.sourceUrl===sourceUrl||o.sourceUrl.startsWith(sourceUrl.replace(/#.*$/,'')+'#'))&&!present.has(o.sourceUrl+'|'+o.foodId)&&(complete||observed.has(o.sourceUrl))?{...o,status:'pending' as const}:o);
  return mergeCatalogOffers(checked,incoming);
}
