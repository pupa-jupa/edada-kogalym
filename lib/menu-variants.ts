import type { Offer, PlanInput, PlanResult, Recipe } from './domain.ts';
import { optimizeMenu } from './optimizer.ts';

export type MenuVariantOptions = {
  limit?: number;
  excludedRecipeIds?: string[];
  excludedFoodIds?: string[];
  excludedRecipeSets?: string[][];
  preferredRecipeIds?: string[];
};

export type MenuVariantsResult = {
  result: PlanResult;
  variants: PlanResult[];
  searched: number;
  limited: boolean;
};

const MAX_SEARCHES = 12;
const recipeSetKey = (ids: string[]) => JSON.stringify([...new Set(ids)].sort());

/**
 * Every returned alternative passes the original whole-package optimizer.
 * Branching on one selected recipe at a time permits overlapping menus without
 * mistaking a portion change for a new menu. At most twelve bounded searches run.
 */
export function optimizeMenuVariants(input: PlanInput, offers: Offer[], recipes: Recipe[], options: MenuVariantOptions = {}, now = new Date()): MenuVariantsResult {
  const limit = Number.isFinite(options.limit) ? Math.min(5, Math.max(1, Math.floor(options.limit!))) : 3;
  const plan = { ...input, excludedFoodIds: [...new Set([...input.excludedFoodIds, ...(options.excludedFoodIds ?? [])])] };
  const excludedIds = new Set(options.excludedRecipeIds ?? []);
  const pool = recipes.filter(recipe => !excludedIds.has(recipe.id));
  const rejectedMenus = new Set((options.excludedRecipeSets ?? []).filter(ids => ids.length > 0).map(recipeSetKey));
  const queue: string[][] = [[]];
  const visited = new Set([recipeSetKey([])]);
  const menuKeys = new Set<string>();
  const variants: PlanResult[] = [];
  let searched = 0;
  let calls = 0;
  let first: PlanResult | undefined;
  let closest: PlanResult | undefined;

  while (queue.length && calls < MAX_SEARCHES && variants.length < limit) {
    const excluded = new Set(queue.shift()!);
    const candidate = optimizeMenu(plan, offers, pool.filter(recipe => !excluded.has(recipe.id)), now, { requiredRecipeIds: options.preferredRecipeIds });
    first ??= candidate;
    calls++;
    searched += candidate.searched;
    const ids = candidate.meals.map(meal => meal.recipe.id).sort();
    const key = recipeSetKey(ids);
    if (!rejectedMenus.has(key)) {
      if ((ids.length > 0 || calls === 1) && (!closest || candidate.macros.protein > closest.macros.protein || (candidate.macros.protein === closest.macros.protein && candidate.totalCost < closest.totalCost))) closest = candidate;
      if (candidate.feasible && !menuKeys.has(key)) {
        menuKeys.add(key);
        variants.push(candidate);
      }
    }
    // Any different recipe set omits at least one dish from this menu. A single
    // cumulative exclusion would lose combinations containing a previous dish.
    for (const id of ids) {
      const next = [...excluded, id].sort();
      const nextKey = recipeSetKey(next);
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);
      queue.push(next);
    }
  }

  const limited = calls === MAX_SEARCHES && queue.length > 0 && variants.length < limit;
  const result = variants[0] ?? closest ?? {
    ...first!, feasible: false, status: 'infeasible' as const,
    message: 'В пределах поиска не найдено другого меню с заданными условиями. Предыдущие сочетания исключены; измените ограничения или верните исключённые блюда.',
    meals: [], shopping: [], macros: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    totalCost: 0, consumedCost: 0, proteinDeficit: Math.max(0, input.proteinMin || 0),
  };
  if (limited) {
    const warning = 'Достигнут лимит 12 поисков альтернатив: другие сочетания могли остаться непроверенными.';
    // Warnings belong to these fresh results, never to caller-owned data.
    for (const variant of variants) variant.warnings.push(warning);
    if (!variants.length) result.warnings = [...result.warnings, warning];
  }
  return { result, variants, searched, limited };
}
