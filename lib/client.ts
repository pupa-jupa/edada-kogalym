import type { Food,Store,Recipe,Offer,Source,SavedPlan,Settings,PlanInput } from './domain';
import type {CatalogListing} from './proshoper';
import type {EnrichmentSummary} from './enrichment';
import type {ReviewView} from './product-review';
export type EnrichmentView={summary:EnrichmentSummary;enabled:boolean;cloudAutomationReady?:boolean;message?:string;items:Array<{key:string;status:string;reason:string;checkedAt:string;retryAt:string;sourceUrl?:string;quantitySourceUrl?:string}>};
export type RecipeLibraryView={enabled:boolean;eligibleFoods:number;coveredFoods:number;generatedRecipes:number;pendingFoods:number;needsReview:number;failedFoods?:number;dailyUsed:number;dailyLimit:number;message?:string;model?:string;running?:boolean};
export type AppData={foods:Food[];stores:Store[];recipes:Recipe[];offers:Offer[];listings:CatalogListing[];sources:Source[];history:SavedPlan[];settings:Settings;input?:PlanInput;refreshMessage?:string;enrichment?:EnrichmentView;review:ReviewView;recipeLibrary:RecipeLibraryView};
export async function api<T=any>(action:string,body?:unknown):Promise<T>{
  const response=await fetch(`/api/${action}`,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json() as T & {error?:string};if(!response.ok)throw new Error(result.error??'Ошибка соединения');return result;
}
export const rub=(value:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2}).format(value);
export const num=(value:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value);
export const date=(value?:string)=>value?new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Yekaterinburg'}).format(new Date(value)):'ещё не проверялся';
