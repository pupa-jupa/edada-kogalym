export type Macros = { kcal: number; protein: number; fat: number; carbs: number };
export type Food = { id: string; name: string; emoji: string; category: string; macros: Macros; allergens: string[] };
export type Store = { id: string; name: string; color: string; short: string; url: string; address?: string; locationSource?: string; locationNote?: string; active?: boolean };
export type Offer = {
  id: string; foodId: string; name: string; storeId: string; price: number; packGrams: number;
  macros: Macros; observedAt: string; validUntil: string; sourceUrl: string; evidence: string;
  localConfirmed: boolean; nutritionEstimated: boolean; status: 'confirmed' | 'pending'; demo: boolean;
  expiryKind?: 'promotion' | 'freshness'; priceCondition?: string;
  minPacks?: number;
  validFrom?: string; localEvidence?: string; verification?: 'user' | 'catalog'; locality?: 'store' | 'city-catalog'; quantityNote?: string;
  barcode?:string;brand?:string;nutritionSourceUrl?:string;nutritionProductName?:string;nutritionObservedAt?:string;
};
export type Ingredient = { foodId: string; grams: number };
export type Recipe = { id: string; name: string; description: string; emoji: string; minutes: number; ingredients: Ingredient[]; steps: string[]; tags: string[]; ai?: boolean };
export type PlanInput = {
  budget: number; proteinMin: number; proteinTolerance: number; kcalMax?: number; fatMax?: number; carbsMax?: number;
  meals: number; maxMinutes: number; storeIds: string[]; excludedFoodIds: string[]; demo: boolean;
};
export type ShoppingItem = { offer: Offer; packs: number; usedGrams: number; purchasedGrams: number; leftoverGrams: number; cost: number };
export type PlannedMeal = { recipe: Recipe; portions: number; macros: Macros; ingredientCost: number };
export type PlanResult = {
  feasible: boolean; status: 'met' | 'tolerance' | 'infeasible'; message: string;
  meals: PlannedMeal[]; shopping: ShoppingItem[]; macros: Macros; totalCost: number; consumedCost: number;
  proteinDeficit: number; warnings: string[]; searched: number; algorithm: string;
};
export type Source = { id: string; storeId: string; url: string; label: string; enabled: boolean; lastAttempt?: string; lastSuccess?: string; error?: string; count?: number;pageCount?:number;coverage?:'partial'|'observed-pages' };
export type Settings = { recipeModel: string; extractionModel: string; cadence: 'daily' | 'weekly' | 'manual'; geminiConfigured: boolean; firecrawlConfigured: boolean; automationReady: boolean };
export type SavedPlan = { id: string; createdAt: string; input: PlanInput; result: PlanResult };
export const DEFAULT_INPUT: PlanInput = { budget: 1200, proteinMin: 120, proteinTolerance: 10, meals: 3, maxMinutes: 40, storeIds: ['5ka', 'svetofor', 'magnit', 'perekrestok', 'monetka'], excludedFoodIds: [], demo: false };
