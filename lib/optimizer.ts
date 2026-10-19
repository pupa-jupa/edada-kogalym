import type { Macros, PlanInput, Offer, Recipe, PlanResult, ShoppingItem } from './domain.ts';

const PORTIONS = [0.5, 1, 1.5, 2];
const MAX_RECIPES = 12;
const MAX_OFFERS_PER_FOOD = 8;
const MAX_ASSIGNMENTS_PER_MENU = 128;
const MAX_SEARCH_NODES = 300_000;
const EPS = 1e-8;
const ALGORITHM = 'Ограниченный детерминированный перебор: до 12 разных рецептов, порции 0,5 / 1 / 1,5 / 2; до 8 предложений на продукт, 128 вариантов корзины на меню и 300 000 узлов. Глобальная оптимальность и доказательство невозможности не гарантируются.';
const zero = (): Macros => ({ kcal: 0, protein: 0, fat: 0, carbs: 0 });
const round = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const validMacros = (m: Macros): boolean => !!m && [m.kcal, m.protein, m.fat, m.carbs].every(n => Number.isFinite(n) && n >= 0);
type Choice = { recipe: Recipe; portions: number };
type Candidate = { choices: Choice[]; shopping: ShoppingItem[]; macros: Macros; cost: number; consumed: number };

/** Pure search: never consults a price/network cache or substitutes catalog nutrition. */
export function optimizeMenu(input: PlanInput, offers: Offer[], recipes: Recipe[], now = new Date()): PlanResult {
  const warnings = ['Поиск ограничен: найденное меню может быть не самым дешёвым; отсутствие решения не доказывает, что его нет.'];
  if (input.demo) warnings.push('Демо-режим: цены, фасовки и наличие вымышлены; это не актуальные предложения Когалыма.');
  let searched = 0;
  const empty = (message: string): PlanResult => ({ feasible: false, status: 'infeasible', message, meals: [], shopping: [], macros: zero(), totalCost: 0, consumedCost: 0, proteinDeficit: Math.max(0, input.proteinMin || 0), warnings, searched, algorithm: ALGORITHM });
  if (!Number.isFinite(input.budget) || input.budget < 0 || !Number.isFinite(input.proteinMin) || input.proteinMin < 0 || ![1, 2, 3].includes(input.meals) || !Number.isFinite(now.getTime())) return empty('Проверьте бюджет, цель по белку, число блюд и дату расчёта.');
  const storeIds = new Set(input.storeIds);
  const excluded = new Set(input.excludedFoodIds);
  const eligible = offers.filter(o => o.status === 'confirmed' && o.localConfirmed === true && o.demo === input.demo && storeIds.has(o.storeId) && !excluded.has(o.foodId)
    && Number.isFinite(o.price) && o.price > 0 && Number.isFinite(o.packGrams) && o.packGrams > 0 && validMacros(o.macros)
    && (o.minPacks === undefined || (Number.isInteger(o.minPacks) && o.minPacks >= 1 && o.minPacks <= 100))
    && (!o.validFrom || (Number.isFinite(Date.parse(o.validFrom)) && Date.parse(o.validFrom) <= now.getTime()))
    && Number.isFinite(Date.parse(o.observedAt)) && Date.parse(o.observedAt) <= now.getTime() && Date.parse(o.validUntil) > now.getTime());
  if (eligible.length < offers.length) warnings.push('Неподходящие магазины, исключённые продукты, неподтверждённые, будущие, просроченные и некорректные цены исключены.');
  if (!eligible.length) return empty('Нет подходящих подтверждённых цен: проверьте магазины, даты и локальное подтверждение.');
  const byFood = new Map<string, Offer[]>();
  for (const o of eligible) {
    const list = byFood.get(o.foodId) ?? [];
    list.push(o);
    byFood.set(o.foodId, list);
  }
  for (const list of byFood.values()) list.sort((a, b) => a.price / a.packGrams - b.price / b.packGrams || a.price - b.price || a.id.localeCompare(b.id));
  const seenIds = new Set<string>();
  const available = recipes.filter(r => {
    if (seenIds.has(r.id) || !Number.isFinite(r.minutes) || r.minutes < 0 || r.minutes > input.maxMinutes || !r.ingredients.length || r.ingredients.length > 12
      || !r.ingredients.every(i => Number.isFinite(i.grams) && i.grams > 0 && !excluded.has(i.foodId) && byFood.has(i.foodId))) return false;
    seenIds.add(r.id);
    return true;
  }).slice(0, MAX_RECIPES);
  if (recipes.length > MAX_RECIPES) warnings.push('В перебор входят первые 12 подходящих рецептов.');
  if (available.length < input.meals) return empty(`Недостаточно разных блюд для меню из ${input.meals}: проверьте исключения, время и наличие подтверждённых цен всех ингредиентов.`);
  const tolerance = Number.isFinite(input.proteinTolerance) ? Math.min(100, Math.max(0, input.proteinTolerance)) : 0;
  const proteinFloor = input.proteinMin * (1 - tolerance / 100);
  const withinMax = (m: Macros): boolean => (input.kcalMax === undefined || m.kcal <= input.kcalMax + EPS)
    && (input.fatMax === undefined || m.fat <= input.fatMax + EPS) && (input.carbsMax === undefined || m.carbs <= input.carbsMax + EPS);
  let best: Candidate | undefined;
  let limited = false;
  const rank = (m: Macros) => m.protein + EPS >= input.proteinMin ? 2 : m.protein + EPS >= proteinFloor ? 1 : 0;
  const better = (c: Candidate, prev: Candidate | undefined): boolean => {
    if (!prev) return true;
    const cr = rank(c.macros), pr = rank(prev.macros);
    if (cr !== pr) return cr > pr;
    if (cr === 0 && Math.abs(c.macros.protein - prev.macros.protein) > EPS) return c.macros.protein > prev.macros.protein;
    return c.cost < prev.cost - EPS || (Math.abs(c.cost - prev.cost) < EPS && c.consumed < prev.consumed - EPS);
  };

  function evaluate(choices: Choice[]) {
    const required = new Map<string, number>();
    for (const c of choices) for (const i of c.recipe.ingredients) required.set(i.foodId, (required.get(i.foodId) ?? 0) + i.grams * c.portions);
    // Equal labels are interchangeable for nutrition: keep the cheapest complete
    // purchase for this aggregated demand (including minimum purchase conditions
    // and leftovers, not unit price). Apply minimums before pruning alternatives.
    const ingredients = [...required.entries()].map(([foodId, usedGrams]) => {
      const labels = new Map<string, ShoppingItem>();
      for (const o of byFood.get(foodId)!) {
        const packs = Math.max(Math.ceil(usedGrams / o.packGrams - EPS), o.minPacks ?? 1);
        const cost = packs * o.price;
        if (!Number.isSafeInteger(packs) || packs <= 0 || !Number.isFinite(cost) || cost > input.budget + EPS) continue;
        const key = `${o.macros.kcal}/${o.macros.protein}/${o.macros.fat}/${o.macros.carbs}`;
        const prev = labels.get(key);
        if (!prev || cost < prev.cost - EPS || (Math.abs(cost - prev.cost) <= EPS && o.price / o.packGrams < prev.offer.price / prev.offer.packGrams)) {
          labels.set(key, { offer: o, packs, usedGrams, purchasedGrams: packs * o.packGrams, leftoverGrams: packs * o.packGrams - usedGrams, cost });
        }
      }
      const options = [...labels.values()].sort((a, b) => a.cost - b.cost || b.offer.macros.protein - a.offer.macros.protein || a.offer.id.localeCompare(b.offer.id));
      if (options.length > MAX_OFFERS_PER_FOOD) limited = true;
      return options.slice(0, MAX_OFFERS_PER_FOOD);
    });
    if (ingredients.some(options => !options.length)) return;
    let assignments = 0;
    const cart: ShoppingItem[] = [];
    const visit = (index: number, m: Macros, cost: number, consumed: number): void => {
      if (searched >= MAX_SEARCH_NODES || assignments >= MAX_ASSIGNMENTS_PER_MENU) { limited = true; return; }
      searched++;
      if (cost > input.budget + EPS || !withinMax(m)) return;
      if (index === ingredients.length) {
        assignments++;
        const candidate = { choices, shopping: cart, macros: m, cost, consumed };
        if (better(candidate, best)) best = { ...candidate, choices: [...choices], shopping: [...cart] };
        return;
      }
      for (const item of ingredients[index]) {
        const scale = item.usedGrams / 100;
        const label = item.offer.macros;
        cart.push(item);
        visit(index + 1, { kcal: m.kcal + label.kcal * scale, protein: m.protein + label.protein * scale, fat: m.fat + label.fat * scale, carbs: m.carbs + label.carbs * scale }, cost + item.cost, consumed + item.usedGrams / item.offer.packGrams * item.offer.price);
        cart.pop();
        if (searched >= MAX_SEARCH_NODES || assignments >= MAX_ASSIGNMENTS_PER_MENU) break;
      }
    };
    visit(0, zero(), 0, 0);
  }

  const choices: Choice[] = [];
  function choose(start: number): void {
    if (searched >= MAX_SEARCH_NODES) { limited = true; return; }
    if (choices.length === input.meals) { evaluate(choices); return; }
    for (let i = start; i <= available.length - (input.meals - choices.length); i++) {
      for (const portions of PORTIONS) {
        choices.push({ recipe: available[i], portions });
        choose(i + 1);
        choices.pop();
      }
    }
  }
  choose(0);
  if (limited) warnings.push('Достигнут лимит перебора: часть вариантов не проверена. Попробуйте меньше блюд или другие ограничения.');
  if (!best) return empty('В пределах поиска нет меню с нужным числом блюд, которое укладывается в бюджет целых упаковок и жёсткие максимумы КБЖУ. Попробуйте увеличить бюджет или изменить ограничения.');
  const winner: Candidate = best;
  const status = rank(winner.macros) === 2 ? 'met' : rank(winner.macros) === 1 ? 'tolerance' : 'infeasible';
  const proteinDeficit = round(Math.max(0, input.proteinMin - winner.macros.protein));
  const chosenOffers = new Map(winner.shopping.map(item => [item.offer.foodId, item.offer]));
  if (winner.shopping.some(i => i.offer.nutritionEstimated)) warnings.push('КБЖУ части продуктов ориентировочные; уточните их по этикеткам.');
  const meals = winner.choices.map(c => {
    const m = zero();
    let ingredientCost = 0;
    for (const i of c.recipe.ingredients) {
      const o = chosenOffers.get(i.foodId)!;
      const grams = i.grams * c.portions;
      for (const key of ['kcal', 'protein', 'fat', 'carbs'] as const) m[key] += o.macros[key] * grams / 100;
      ingredientCost += grams / o.packGrams * o.price;
    }
    return { recipe: c.recipe, portions: c.portions, macros: m, ingredientCost };
  });
  return {
    feasible: status !== 'infeasible', status,
    message: status === 'met' ? 'Цель по белку выполнена. Покупка целых упаковок укладывается в бюджет.'
      : status === 'tolerance' ? `Меню в допустимом недоборе белка: не хватает ${proteinDeficit} г до полной цели.`
        : `В пределах поиска белка недостаточно: недобор ${proteinDeficit} г превышает разрешённые ${tolerance}%. Показан ближайший найденный вариант в бюджете и жёстких максимумах.`,
    meals, shopping: winner.shopping, macros: winner.macros, totalCost: round(winner.cost), consumedCost: winner.consumed,
    proteinDeficit, warnings, searched, algorithm: ALGORITHM,
  };
}
