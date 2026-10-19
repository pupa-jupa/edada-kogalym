import type { Offer } from "../lib/domain.ts";
import { FOODS, STORES } from "../lib/catalog.ts";
// Synthetic data used only by automated tests; never imported by application code.
// Цена целой упаковки в рублях и её съедобная масса в граммах.
// Для яиц: условная упаковка 10 шт. = 500 г БЕЗ скорлупы.
const DEMO_PACKS: Record<string, [number, number]> = {
  chicken: [230, 600], turkey: [290, 500], pollock: [210, 600], egg: [110, 500],
  cottage: [95, 200], milk: [85, 1000], kefir: [80, 900], buckwheat: [90, 800],
  rice: [95, 800], oats: [65, 400], pasta: [70, 450], lentils: [125, 450],
  potato: [75, 1000], carrot: [50, 1000], onion: [45, 1000], cabbage: [65, 1000],
  tomato: [130, 500], cucumber: [110, 500], apple: [120, 1000], oil: [140, 900],
};

export function getTestOffers(now = new Date()): Offer[] {
  const observedAt = now.toISOString();
  const validUntil = new Date(now.getTime() + 7 * 86400000).toISOString();
  return STORES.filter(s=>["5ka","svetofor","magnit"].includes(s.id)).flatMap((store, index) => FOODS.filter(f=>DEMO_PACKS[f.id]).map((food, foodIndex) => {
    const [basePrice, packGrams] = DEMO_PACKS[food.id];
    return {
      id: `demo-${store.id}-${food.id}`, foodId: food.id, name: `${food.name} · пример`, storeId: store.id,
      price: Math.round(basePrice * [1, 0.88, 1.04][(index + foodIndex) % 3]), packGrams,
      macros: { ...food.macros }, observedAt, validUntil, sourceUrl: store.url,
      evidence: 'ДЕМО: вымышленные примерные цены и фасовки для проверки расчёта. Наличие и цены в Когалыме не подтверждены. КБЖУ справочные.',
      localConfirmed: true, nutritionEstimated: true, status: 'confirmed' as const, demo: true,
    };
  }));
}
