import type { Offer, PlanResult } from './domain.ts';
import {preferStorePrices} from './offer-selection.ts';

type Availability = 'listed' | 'in-stock' | 'out-of-stock' | 'unknown';
type AvailabilityOffer = Offer & { availability?: Availability };
export type PriceProvenance = { url?: string; label: string; checked: string; validity: string; scope: string };

function safeUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : undefined;
  } catch { return undefined; }
}

const text = (value?: string) => (value ?? '').trim().replace(/\s+/g, ' ');
const time = (value?: string) => value ? Date.parse(value) : undefined;
const sourceIdentity = (value: string) => safeUrl(value)?.href ?? text(value);

function eligible(offer: AvailabilityOffer, now: number): boolean {
  const observed = Date.parse(offer.observedAt);
  const end = Date.parse(offer.validUntil);
  const start = time(offer.validFrom);
  return offer.status === 'confirmed' && offer.localConfirmed === true
    && offer.availability !== 'out-of-stock' && offer.availability !== 'unknown'
    && Number.isFinite(observed) && observed <= now && Number.isFinite(end) && end > now
    && (start === undefined || (Number.isFinite(start) && start <= now))
    && Number.isFinite(offer.price) && offer.price > 0
    && Number.isFinite(offer.packGrams) && offer.packGrams > 0
    && [offer.macros.kcal, offer.macros.protein, offer.macros.fat, offer.macros.carbs].every(value => Number.isFinite(value) && value >= 0)
    && (offer.minPacks === undefined || Number.isInteger(offer.minPacks) && offer.minPacks >= 1 && offer.minPacks <= 100);
}

/** Compare purchase facts rather than refresh metadata in a saved shopping list. */
export function planIsOutdated(result: PlanResult, offers: Offer[], now = new Date()): boolean {
  if (!Number.isFinite(now.getTime())) return true;
  const current = new Map(preferStorePrices(offers,now).map(offer => [offer.id, offer]));
  return result.shopping.some(({ offer: saved }) => {
    const live = current.get(saved.id);
    if (!live || !eligible(live, now.getTime())) return true;
    return live.foodId !== saved.foodId || live.storeId !== saved.storeId
      || text(live.name) !== text(saved.name)
      || live.price !== saved.price || live.packGrams !== saved.packGrams
      || (live.minPacks ?? 1) !== (saved.minPacks ?? 1)
      || text(live.priceCondition) !== text(saved.priceCondition)
      || sourceIdentity(live.sourceUrl) !== sourceIdentity(saved.sourceUrl)
      || live.status !== saved.status || live.localConfirmed !== saved.localConfirmed
      || live.locality !== saved.locality || live.verification !== saved.verification
      || live.demo !== saved.demo || live.nutritionEstimated !== saved.nutritionEstimated
      || (live.expiryKind ?? 'freshness') !== (saved.expiryKind ?? 'freshness')
      || time(live.validFrom) !== time(saved.validFrom)
      || ((live.expiryKind === 'promotion' || saved.expiryKind === 'promotion') && time(live.validUntil) !== time(saved.validUntil))
      || (['kcal', 'protein', 'fat', 'carbs'] as const).some(key => live.macros[key] !== saved.macros[key]);
  });
}

const localDate = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Yekaterinburg', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function formatDate(value?: string): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return localDate.format(new Date(value));
}

/** Describe the price evidence without presenting a city catalogue as live stock. */
export function priceProvenance(offer: Offer): PriceProvenance {
  const url = safeUrl(offer.sourceUrl);
  const host = url?.hostname.replace(/^www\./, '') ?? '';
  const sourceNames: Record<string, string> = { 'proshoper.ru': 'Proshoper', 'magnit.ru': 'Магнит', '5ka.ru': 'Пятёрочка', 'perekrestok.ru': 'Перекрёсток', 'monetka.ru': 'Монетка' };
  const knownHost = Object.keys(sourceNames).find(domain => host === domain || host.endsWith(`.${domain}`));
  const checked = formatDate(offer.observedAt);
  const from = formatDate(offer.validFrom);
  const until = formatDate(offer.validUntil);
  const scope = !offer.localConfirmed || offer.status !== 'confirmed'
    ? 'Локальность цены и наличие в конкретном магазине не подтверждены.'
    : offer.locality === 'city-catalog'
      ? 'Городской каталог Когалыма; цена и остатки конкретного магазина не подтверждены.'
      : offer.locality === 'store'
        ? 'Цена конкретного магазина подтверждена; наличие перед покупкой уточните.'
        : 'Локальная цена подтверждена; конкретный магазин и остатки не подтверждены.';
  return {
    ...(url ? { url: url.href } : {}),
    label: knownHost ? sourceNames[knownHost] : host || 'Источник не указан',
    checked: checked ? `Проверено ${checked} (Когалым)` : 'Дата проверки не указана',
    validity: until ? `${offer.expiryKind === 'promotion' ? 'Срок акции' : 'Проверить заново'}: ${from ? `с ${from} ` : ''}до ${until} (Когалым)` : 'Срок цены не подтверждён',
    scope,
  };
}
