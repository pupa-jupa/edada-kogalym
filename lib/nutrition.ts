import {macrosSchema} from './validation.ts';
import type {Macros} from './domain.ts';
export type NutritionCandidate={code:string;productName:string;brand:string;quantity:string;macros:Macros;estimated:boolean;sourceUrl:string;observedAt:string};
export function validBarcode(value:string):boolean{if(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value))return false;const digits=[...value].map(Number);const check=digits.pop()!;const sum=digits.reverse().reduce((total,n,i)=>total+n*(i%2===0?3:1),0);return (10-sum%10)%10===check;}
export function parseNutrition(raw:unknown,code:string,now=new Date()):NutritionCandidate{
  const data=raw as {product?:Record<string,any>};const p=data?.product;if(!p||String(p.code)!==code)throw new Error('Точный штрихкод не найден в Open Food Facts');
  const set=p.nutrition?.aggregated_set;if(set?.per!=='100g'||set?.preparation!=='as_sold')throw new Error('Нужны КБЖУ на 100 г продукта до приготовления');
  const n=set.nutrients;const keys={kcal:'energy-kcal',protein:'proteins',fat:'fat',carbs:'carbohydrates'} as const;
  const macros={} as Macros;let estimated=false;
  for(const [key,id] of Object.entries(keys)){const entry=n?.[id];if(!entry||entry.source_per!=='100g'||entry.unit!==(key==='kcal'?'kcal':'g')||typeof entry.value!=='number')throw new Error('В базе нет полных КБЖУ именно на 100 г. Сверьте этикетку вручную.');macros[key as keyof Macros]=entry.value;if(!['manufacturer','packaging'].includes(entry.source))estimated=true;}
  return {code,productName:String(p.product_name??'').slice(0,300),brand:String(p.brands??'').slice(0,200),quantity:String(p.quantity??'').slice(0,200),macros:macrosSchema.parse(macros),estimated,sourceUrl:`https://world.openfoodfacts.org/product/${code}`,observedAt:now.toISOString()};
}
