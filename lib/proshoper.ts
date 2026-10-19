export type CatalogListing = {
  id: string; name: string; storeId: string; sourceUrl: string; sourceId: string;
  price?: number; packGrams?: number; packText?: string; priceUnit: 'pack' | 'kg' | 'unknown';
  availability: 'listed' | 'in-stock' | 'out-of-stock' | 'unknown'; observedAt: string; lastSeenAt: string;
  validFrom?: string; validUntil?: string; localEvidence: string; evidence: string;
  lastChangedAt?:string;
  changes?: Array<{ at: string; price?: number; packGrams?: number; availability: CatalogListing['availability'];name?:string;priceUnit?:CatalogListing['priceUnit'];validFrom?:string;validUntil?:string }>;
  barcode?: string; brand?: string;
};
type Element = { tag: string; attrs: Record<string, string>; children: Array<Element | string>; parent?: Element };
export type ProshoperPage = { url: string; validFrom?: string; validUntil?: string; localEvidence: string };
type ProshoperSource = { id: string; storeId: string; url: string };
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const entities: Record<string, string> = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '—', laquo: '«', raquo: '»', rub: '₽' };
function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] !== '#') return entities[key.toLowerCase()] ?? entity;
    const code = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
function tree(html: string): Element {
  const root: Element = { tag: 'root', attrs: {}, children: [] }, stack = [root];
  const clean = html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const tokens = /<\/?([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)/gi;
  for (const match of clean.matchAll(tokens)) {
    const current = stack[stack.length - 1];
    if (match[3] !== undefined) { current.children.push(decode(match[3])); continue; }
    const tag = match[1].toLowerCase();
    if (match[0].startsWith('</')) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const attr of match[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) attrs[attr[1].toLowerCase()] = decode(attr[2] ?? attr[3] ?? attr[4] ?? '');
    const node: Element = { tag, attrs, children: [], parent: current };
    current.children.push(node);
    if (!voidTags.has(tag) && !match[2].endsWith('/')) stack.push(node);
  }
  return root;
}
function text(node: Element): string {
  return node.children.map(child => typeof child === 'string' ? child : text(child)).join(' ').replace(/\s+/g, ' ').trim();
}
function all(node: Element): Element[] {
  const result: Element[] = [];
  for (const child of node.children) if (typeof child !== 'string') { result.push(child); result.push(...all(child)); }
  return result;
}
const hasClass = (node: Element, name: string): boolean => (node.attrs.class ?? '').split(/\s+/).includes(name);
function productPrice(card: Element): number | undefined {
  const node = all(card).find(child => hasClass(child, 'product__price-new'));
  if (!node) return undefined;
  const rubles = node.children.filter(child => typeof child === 'string').join('').replace(/\s/g, '');
  const pennies = node.children.find(child => typeof child !== 'string' && /^\d{1,2}$/.test(text(child)));
  const amount = /^\d+$/.test(rubles) && pennies && typeof pennies !== 'string'
    ? Number(`${rubles}.${text(pennies).padStart(2, '0')}`)
    : Number(text(node).replace(/\s/g, '').replace(/(?:₽|руб\.?)/gi, '').replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}
function quantity(name: string): Pick<CatalogListing, 'packGrams' | 'packText' | 'priceUnit'> {
  // Unit-price parentheses are not another package weight. Never read image text.
  const label = name.replace(/\([^)]*(?:₽|руб\.?)[^)]*\)/gi, '').replace(/\d+(?:[.,]\d+)?\s*(?:₽|руб\.?)\s*\/\s*\d*\s*кг/gi, '');
  const multipack = label.match(/(\d+)\s*(?:пак(?:ет\w*)?\.?\s*)?[xх×*]\s*(\d+(?:[.,]\d+)?)\s*(кг|г)(?![а-яa-z])/i);
  if (multipack) return { packText: multipack[0], packGrams: Number(multipack[1]) * Number(multipack[2].replace(',', '.')) * (multipack[3].toLowerCase() === 'кг' ? 1000 : 1), priceUnit: 'pack' };
  const mass = label.match(/(?:^|[\s,(])(\d+(?:[.,]\d+)?)\s*(кг|г)(?![а-яa-z])/i);
  if (mass) {
    const grams = Number(mass[1].replace(',', '.')) * (mass[2].toLowerCase() === 'кг' ? 1000 : 1);
    const byKg = mass[2].toLowerCase() === 'кг' && grams === 1000 && !/(?:упаков|фасов|пачк|пакет|пак\.|\bуп\.)/i.test(label);
    return { packText: mass[0].trim(), ...(byKg ? {} : { packGrams: grams }), priceUnit: byKg ? 'kg' : 'pack' };
  }
  const volumeOrCount = label.match(/(?:^|[\s,(])(\d+(?:[.,]\d+)?)\s*(мл|л|шт\.?)(?![а-яa-z])/i);
  return volumeOrCount ? { packText: volumeOrCount[0].trim(), priceUnit: 'pack' } : { priceUnit: 'unknown' };
}
const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function campaignDates(value: string): Pick<CatalogListing, 'validFrom' | 'validUntil'> | undefined {
  const match = value.toLowerCase().match(/(?:с\s*)?(\d{1,2})\s*(?:([а-я]+)\s*)?(?:по|[–—-])\s*(\d{1,2})\s+([а-я]+)\s+(20\d{2})/);
  if (!match) return undefined;
  const endMonth = months.indexOf(match[4]) + 1, startMonth = match[2] ? months.indexOf(match[2]) + 1 : endMonth;
  if (!startMonth || !endMonth) return undefined;
  const endYear = Number(match[5]), startYear = startMonth > endMonth ? endYear - 1 : endYear;
  const date = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const start = date(startYear, startMonth, Number(match[1])), end = date(endYear, endMonth, Number(match[3]));
  if ([start, end].some(day => { const parsed = new Date(`${day}T00:00:00Z`); return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day; }) || start > end) return undefined;
  return { validFrom: `${start}T00:00:00+05:00`, validUntil: `${end}T23:59:59.999+05:00` };
}
function scopedDates(card: Element): Pick<CatalogListing, 'validFrom' | 'validUntil'> {
  const isScope = (node: Element) => ['section', 'article'].includes(node.tag) || /(?:^|[\s_-])(?:catalog|campaign)(?:[\s_-]|$)/i.test(node.attrs.class ?? '');
  for (let scope = card.parent; scope && scope.tag !== 'root'; scope = scope.parent) {
    // A page-level date or a campaign on a neighbouring card is not this card's promotion.
    if (!isScope(scope)) continue;
    const candidates = all(scope).filter(node => {
      if (!hasClass(node, 'catalog_dates')) return false;
      for (let parent = node.parent; parent && parent !== scope; parent = parent.parent) if (isScope(parent)) return false;
      return true;
    });
    if (!candidates.length) continue;
    const distinct = [...new Set(candidates.map(node => text(node)))];
    return distinct.length === 1 ? campaignDates(distinct[0]) ?? {} : {};
  }
  return {};
}

function cityEvidence(nodes: Element[]): string {
  const cityNode = nodes.find(node => /^h[12]$/.test(node.tag) && /каталог|акци/i.test(text(node)) && /(?:^|[^а-я])Когалым(?:а|е)?(?:$|[^а-я])/i.test(text(node)))
    ?? nodes.find(node => node.tag === 'a' && /\/cities\/?(?:[?#]|$)/.test(node.attrs.href ?? '') && /^Когалым$/i.test(text(node)))
    ?? nodes.find(node => node.tag === 'a' && hasClass(node, 'breadcrumbs-home') && /^Прошопер\s*[—–-]\s*Когалым$/i.test(node.attrs.title ?? ''));
  if (!cityNode) throw new Error('Содержимое каталога не подтверждает город Когалым');
  return `В содержимом Proshoper: «${text(cityNode) || cityNode.attrs.title}». Городской каталог Когалыма; наличие в конкретном магазине не проверено.`;
}
function spoilerUrl(value: string, source: ProshoperSource): string | undefined {
  try {
    const origin = new URL(source.url), url = new URL(value, origin);
    if (origin.protocol !== 'https:' || !/^(?:www\.)?proshoper\.ru$/.test(origin.hostname) || (origin.port && origin.port !== '443')) return undefined;
    if (url.origin !== origin.origin || url.username || url.password || url.hash || !/^\/_catalog_products_spoiler\/\d+\/$/.test(url.pathname)) return undefined;
    return url.href;
  } catch { return undefined; }
}
function trustedContext(context: ProshoperPage, source: ProshoperSource): ProshoperPage {
  if (!context?.localEvidence?.trim() || !spoilerUrl(context.url, source)) throw new Error('Нет доверенного контекста наблюдённой страницы Proshoper');
  return context;
}

/** Return only spoiler URLs actually observed in the supplied snapshot, without inventing pagination. */
export function getProshoperPages(html: string, source: ProshoperSource, context?: ProshoperPage): ProshoperPage[] {
  const nodes = all(tree(html));
  const inherited = context ? trustedContext(context, source) : undefined;
  const localEvidence = inherited?.localEvidence ?? cityEvidence(nodes), pages = new Map<string, ProshoperPage>();
  for (const node of nodes) {
    if (!node.attrs['hx-get']) continue;
    const url = spoilerUrl(node.attrs['hx-get'], source);
    if (!url || pages.has(url)) continue;
    pages.set(url, { url, ...(inherited?.validFrom ? { validFrom: inherited.validFrom } : {}), ...(inherited?.validUntil ? { validUntil: inherited.validUntil } : {}), ...scopedDates(node), localEvidence });
  }
  return [...pages.values()];
}

function parseRows(nodes: Element[], source: ProshoperSource, localEvidence: string, now: Date, context?: ProshoperPage): CatalogListing[] {
  const observedAt = now.toISOString();
  const page = new URL(source.url); page.hash = '';
  const rows = new Map<string, CatalogListing>();
  for (const card of nodes.filter(node => node.tag === 'article' && /^id_product_\d+$/.test(node.attrs.id ?? ''))) {
    const productId = card.attrs.id, descendants = all(card);
    const name = text(descendants.find(node => hasClass(node, 'product__name')) ?? card) || `Товар ${productId}`;
    const explicitQuantity = descendants.find(node => hasClass(node, 'product__weight') || hasClass(node, 'product__pack'));
    const pack = quantity(explicitQuantity ? `${name} ${text(explicitQuantity)}` : name), price = productPrice(card);
    const sourceUrl = `${page.href}#${productId}`, id = `proshoper:${encodeURIComponent(source.id)}:${productId}`;
    const row: CatalogListing = { id, name, storeId: source.storeId, sourceUrl, sourceId: source.id, ...(price === undefined ? {} : { price }), ...pack,
      availability: 'listed', observedAt, lastSeenAt: observedAt, ...(context?.validFrom ? { validFrom: context.validFrom } : {}), ...(context?.validUntil ? { validUntil: context.validUntil } : {}), ...scopedDates(card), localEvidence,
      evidence: `Proshoper #${productId}: «${name}»; ${price === undefined ? 'цена не распознана' : `цена ${price.toFixed(2)} ₽`}; ${pack.packText ? `обозначение количества «${pack.packText}»` : 'фасовка не указана'}. Карточка опубликована в каталоге; остатки не проверены.` };
    if (!rows.has(id)) rows.set(id, row);
  }
  return [...rows.values()];
}

/** Parse only the supplied city-catalogue snapshot; listing is not proof of shelf stock. */
export function parseProshoper(html: string, source: ProshoperSource, now = new Date()): CatalogListing[] {
  const nodes = all(tree(html));
  return parseRows(nodes, source, cityEvidence(nodes), now);
}

/** Fragment geography and fallback campaign dates come only from its observed root link. */
export function parseProshoperFragment(html: string, source: ProshoperSource, context: ProshoperPage, now = new Date()): CatalogListing[] {
  const inherited = trustedContext(context, source);
  return parseRows(all(tree(html)), source, inherited.localEvidence, now, inherited);
}
