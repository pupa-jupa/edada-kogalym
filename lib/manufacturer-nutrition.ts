import type {Offer} from './domain.ts';
// Exact manufacturer pages for two independently checked package sizes, 19 Oct 2026.
export function manufacturerNutrition(offer:Offer):Offer{
  if(offer.foodId!=='cottage-grained'||!/простоквашино/iu.test(offer.name)||!/(?:^|[^\d.,])5\s*%/.test(offer.name)||![130,320].includes(offer.packGrams))return offer;
  return {...offer,macros:{kcal:91,protein:9,fat:5,carbs:2.6},nutritionEstimated:false,brand:'Простоквашино',nutritionSourceUrl:`https://prostokvashino.ru/product/zernenyy-tvorog-prostokvashino-v-slivkakh-5--${offer.packGrams}g/`,nutritionProductName:`Зернёный творог Простоквашино в сливках 5%, ${offer.packGrams} г`,nutritionObservedAt:'2026-10-19T12:58:00Z'};
}
