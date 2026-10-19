import { z } from 'zod';
import type { Offer, Recipe } from './domain.ts';

export const macrosSchema = z.object({ kcal: z.number().min(0).max(1000), protein: z.number().min(0).max(100), fat: z.number().min(0).max(100), carbs: z.number().min(0).max(100) }).refine(m => m.protein + m.fat + m.carbs <= 105, 'Сумма БЖУ на 100 г некорректна');
export const inputSchema = z.object({
  budget: z.number().min(1).max(100000), proteinMin: z.number().min(0).max(500), proteinTolerance: z.number().min(0).max(30),
  kcalMax: z.number().min(1).max(15000).optional(), fatMax: z.number().min(0).max(1000).optional(), carbsMax: z.number().min(0).max(2000).optional(),
  meals: z.number().int().min(1).max(3), maxMinutes: z.number().min(5).max(180), storeIds: z.array(z.enum(['5ka','svetofor','magnit'])).min(1).max(3),
  excludedFoodIds: z.array(z.string().max(40)).max(50), demo: z.boolean(),
});
const offerSchema = z.object({
  id: z.string().min(1).max(120), foodId: z.string().max(40), name: z.string().min(1).max(200), storeId: z.enum(['5ka','svetofor','magnit']),
  price: z.number().positive().max(100000), packGrams: z.number().positive().max(20000), macros: macrosSchema,
  observedAt: z.string().datetime({ offset: true }), validUntil: z.string().datetime({ offset: true }),
  sourceUrl: z.string().max(2000), evidence: z.string().min(1).max(2000), localConfirmed: z.boolean(), nutritionEstimated: z.boolean(),
  status: z.enum(['confirmed','pending']), demo: z.literal(false),
  expiryKind: z.enum(['promotion','freshness']).optional(), priceCondition:z.string().max(300).optional(),
  minPacks:z.number().int().min(1).max(100).optional(),
});
export function validateOffer(raw: unknown, foods: string[], now = new Date()): Offer {
  const o = offerSchema.parse(raw);
  if (!foods.includes(o.foodId)) throw new Error('Неизвестный продукт в справочнике');
  if (Date.parse(o.observedAt) > now.getTime() + 60000) throw new Error('Дата наблюдения цены находится в будущем');
  if (Date.parse(o.validUntil) <= Date.parse(o.observedAt) || Date.parse(o.validUntil) < now.getTime()) throw new Error('Срок действия цены истёк или некорректен');
  if (o.status === 'confirmed' && !o.localConfirmed) throw new Error('Подтвердите магазин в Когалыме');
  const quantity=o.priceCondition?.match(/(?:от|минимум|не менее)\s*(\d+)/i);
  if(quantity&&Number(quantity[1])>(o.minPacks??1))throw new Error('Укажите минимальное число упаковок для этой цены в отдельном поле');
  if(o.priceCondition&&/(?:[23]\s*[+=]|по цене|от двух|от тр[её]х|при покупке)/i.test(o.priceCondition))throw new Error('Это сложное условие акции. Укажите обычную цену либо цену за упаковку и точный минимум упаковок.');
  if (o.sourceUrl) validateSourceUrl(o.sourceUrl);
  return o;
}
const recipeSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(160), description: z.string().max(400), emoji: z.string().max(10), minutes: z.number().int().min(3).max(180),
  ingredients: z.array(z.object({foodId:z.string().max(40),grams:z.number().min(1).max(1500)})).min(1).max(10),
  steps: z.array(z.string().min(1).max(1000)).min(2).max(10), tags: z.array(z.string().max(40)).max(6), ai: z.boolean().optional(),
});
export function validateRecipes(raw: unknown, foods: string[]): Recipe[] {
  const recipes = z.array(recipeSchema).min(1).max(12).parse(raw);
  for (const r of recipes) {
    const ids = r.ingredients.map(i => i.foodId);
    if (new Set(ids).size !== ids.length || ids.some(id => !foods.includes(id))) throw new Error('Gemini вернул неизвестные или повторяющиеся ингредиенты');
  }
  return recipes.map((r, i) => ({...r,id:`ai-${i}-${r.id}`,ai:true}));
}
export function validateSourceUrl(value: string): string {
  const u = new URL(value);
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !h.includes('.') || h.includes(':') || /^[\d.]+$/.test(h) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(h) || h.endsWith('.localhost')) throw new Error('Нужен HTTPS-адрес публичного магазина без пароля и нестандартного порта');
  return u.href;
}
