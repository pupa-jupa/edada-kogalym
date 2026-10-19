import type { Offer } from './domain.ts';

const officialDomains: Record<string, string> = { magnit: 'magnit.ru', '5ka': '5ka.ru', perekrestok: 'perekrestok.ru', monetka: 'monetka.ru', svetofor: 'svetofor-nsk.ru' };
const identity = (offer: Offer) => JSON.stringify([offer.storeId, offer.name.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim().replace(/\s+/g, ' '), offer.packGrams]);

function active(offer: Offer, now: number): boolean {
  const availability = (offer as Offer & { availability?: string }).availability;
  return !offer.demo && offer.status === 'confirmed' && offer.localConfirmed
    && availability !== 'out-of-stock' && availability !== 'unknown'
    && Number.isFinite(offer.price) && offer.price > 0 && Number.isFinite(offer.packGrams) && offer.packGrams > 0
    && !!offer.macros && [offer.macros.kcal, offer.macros.protein, offer.macros.fat, offer.macros.carbs].every(value => Number.isFinite(value) && value >= 0)
    && (offer.minPacks === undefined || (Number.isInteger(offer.minPacks) && offer.minPacks >= 1 && offer.minPacks <= 100))
    && Number.isFinite(Date.parse(offer.observedAt)) && Date.parse(offer.observedAt) <= now
    && Number.isFinite(Date.parse(offer.validUntil)) && Date.parse(offer.validUntil) > now
    && (!offer.validFrom || (Number.isFinite(Date.parse(offer.validFrom)) && Date.parse(offer.validFrom) <= now));
}

function officialSource(offer: Offer): boolean {
  const domain = officialDomains[offer.storeId];
  if (!domain) return false;
  try {
    const url = new URL(offer.sourceUrl);
    return url.protocol === 'https:' && !url.username && !url.password
      && (url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}

/** Keep raw evidence intact; suppress only a currently superseded city price. */
export function preferStorePrices(offers: Offer[], now = new Date()): Offer[] {
  const at = now.getTime();
  if (!Number.isFinite(at)) return [...offers];
  const exactStoreProducts = new Set(offers.filter(offer => offer.locality === 'store' && active(offer, at) && officialSource(offer)).map(identity));
  return offers.filter(offer => offer.locality !== 'city-catalog' || !active(offer, at) || !exactStoreProducts.has(identity(offer)));
}
