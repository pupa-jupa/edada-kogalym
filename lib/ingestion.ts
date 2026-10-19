import type { Offer,Source } from './domain.ts';
import { FOODS } from './catalog.ts';
import { validateOffer } from './validation.ts';
export function normalizeExtracted(value:unknown,source:Source,now=new Date()):Offer|null{
  if(!value||typeof value!=='object')return null;
  const r=value as Record<string,unknown>;
  const food=FOODS.find(f=>f.id===r.foodId);if(!food)return null;
  if(typeof r.price!=='number'||typeof r.packGrams!=='number')return null;
  const hasLabel=['kcal','protein','fat','carbs'].every(k=>typeof r[k]==='number');
  const macros=hasLabel?{kcal:r.kcal as number,protein:r.protein as number,fat:r.fat as number,carbs:r.carbs as number}:food.macros;
  const promotion=typeof r.validUntil==='string'&&r.validUntil.trim()!=='';
  try {return validateOffer({id:crypto.randomUUID(),foodId:food.id,name:r.name,price:r.price,packGrams:r.packGrams,macros,storeId:source.storeId,observedAt:now.toISOString(),validUntil:promotion?r.validUntil:new Date(now.getTime()+86400000).toISOString(),expiryKind:promotion?'promotion':'freshness',priceCondition:typeof r.priceCondition==='string'?r.priceCondition:'Условия цены не установлены',sourceUrl:source.url,evidence:`${String(r.evidence??'')}\nГеография: ${String(r.localEvidence??'не подтверждена')}\n${promotion?'Срок акции со страницы':'Срок акции не указан; свежесть наблюдения ограничена 24 часами'}`.slice(0,2000),localConfirmed:false,nutritionEstimated:!hasLabel,status:'pending',demo:false},FOODS.map(f=>f.id),now);}catch{return null;}
}
