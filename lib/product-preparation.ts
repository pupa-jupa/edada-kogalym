import type {PreparationEvidence} from './domain.ts';
import type {CatalogListing} from './proshoper.ts';
import {enrichedFood,enrichmentKey,validPreparationEvidence,type EnrichmentRecord} from './product-enrichment.ts';
import {foodIdentity} from './recipe-library.ts';
export type PreparationResolution={foodId:string;expectedIdentity:string;preparation:PreparationEvidence};
/** A research result can update a current matching product, never impersonate its owner. */
export function resolveProductPreparation(listings:CatalogListing[],records:EnrichmentRecord[],entries:PreparationResolution[],now=new Date()){
 const byKey=new Map(records.map(r=>[r.key,r])),rows=new Map(listings.map(r=>[enrichmentKey(r),r]));
 const applied:string[]=[],rejected:Array<{foodId:string;reason:string}>=[];
 for(const entry of entries){
  const key=entry.foodId.replace(/^e-/,''),row=rows.get(key),current=byKey.get(key);
  const food=row&&current?.candidate?enrichedFood(row,current.candidate):null;
  if(!food||current?.status!=='matched'||current.userExcluded||current.candidate?.userVerified||foodIdentity(food)!==entry.expectedIdentity||!validPreparationEvidence(entry.preparation,now)){
   rejected.push({foodId:entry.foodId,reason:'Данные изменились, подтверждены владельцем или недостаточно доказательств подготовки.'});continue;
  }
  const candidate={...current.candidate!,preparation:{...entry.preparation}};
  if(!enrichedFood(row!,candidate)){rejected.push({foodId:entry.foodId,reason:'Не совпадает идентичность продукта.'});continue;}
  byKey.set(key,{...current,candidate,checkedAt:now.toISOString(),reason:'Подготовка продукта подтверждена внешним источником; КБЖУ сохранены.'});applied.push(entry.foodId);
 }
 return {records:[...byKey.values()],applied,rejected};
}
