'use client';

import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Download, ExternalLink, KeyRound, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import type { Offer, Source } from '../../lib/domain';
import type { AppData } from '../../lib/client';
import { date, num, rub } from '../../lib/client';
import { FOODS, STORES, getDemoOffers } from '../../lib/catalog';
import { parseOfferImport } from './import-utils';

type Model = { id: string; name: string };
type Props = { data: AppData; run: (action: string, body?: unknown) => Promise<{ message?: string; models?: Model[] } | undefined>; busy: boolean };
const macroLabels = { kcal: 'Ккал', protein: 'Белки, г', fat: 'Жиры, г', carbs: 'Углеводы, г' };
const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие.';
const swallow = () => {}; // run already displays server errors in the application's toast.
function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return <label className="field"><span>{label}</span>{children}{help && <small className="help">{help}</small>}</label>;
}
function StoreOptions() { return STORES.map(store => <option key={store.id} value={store.id}>{store.name}</option>); }
function localDate(value: string) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function OfferForm({ offer, run, busy, onSaved }: { offer?: Offer; run: Props['run']; busy: boolean; onSaved?: () => void }) {
  const [foodId, setFoodId] = useState(offer?.foodId ?? FOODS[0].id);
  const [macros, setMacros] = useState(offer?.macros ?? FOODS[0].macros);
  const [estimated, setEstimated] = useState(offer?.nutritionEstimated ?? true);
  const [status, setStatus] = useState<Offer['status']>(offer?.status ?? 'pending');
  const [error, setError] = useState('');
  const [now] = useState(() => new Date());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const values = new FormData(event.currentTarget);
    try {
      const row = {
        ...(offer ? { id: offer.id } : {}), foodId, name: String(values.get('name')).trim(), storeId: String(values.get('storeId')),
        price: Number(values.get('price')), packGrams: Number(values.get('packGrams')), macros,
        minPacks:Number(values.get('minPacks')||1),
        observedAt: new Date(String(values.get('observedAt'))).toISOString(), validUntil: new Date(String(values.get('validUntil'))).toISOString(),
        sourceUrl: String(values.get('sourceUrl')).trim(), evidence: String(values.get('evidence')).trim(),
        localConfirmed: values.get('localConfirmed') === 'on', nutritionEstimated: estimated, status, demo: false,
        priceCondition: String(values.get('priceCondition')).trim(), expiryKind: String(values.get('expiryKind')),
      };
      await run('offers', { offers: [row] }); onSaved?.();
    } catch (caught) { setError(message(caught)); }
  }
  return <form className="stack" onSubmit={submit}>
    <p className="help">Проверьте Когалым, конкретную фасовку, условия покупки и срок цены. Для яиц укажите массу без скорлупы, для овощей — съедобную часть.</p>
    <div className="form-grid">
      <Field label="Продукт из справочника"><select required value={foodId} onChange={event => { const food = FOODS.find(item => item.id === event.target.value)!; setFoodId(food.id); setMacros({ ...food.macros }); setEstimated(true); }} name="foodId">{FOODS.map(food => <option key={food.id} value={food.id}>{food.emoji} {food.name}</option>)}</select></Field>
      <Field label="Название товара на упаковке"><input name="name" defaultValue={offer?.name ?? ''} required maxLength={200} placeholder="Например, филе охлаждённое, 600 г" /></Field>
      <Field label="Магазин"><select name="storeId" required defaultValue={offer?.storeId ?? '5ka'}><StoreOptions /></select></Field>
      <Field label="Цена целой упаковки, ₽"><input name="price" type="number" min="0.01" max="100000" step="0.01" defaultValue={offer?.price} required /></Field>
      <Field label="Съедобная масса упаковки, г"><input name="packGrams" type="number" min="0.1" max="20000" step="0.1" defaultValue={offer?.packGrams} required /></Field>
      <Field label="Условия цены"><input name="priceCondition" maxLength={300} defaultValue={offer?.priceCondition ?? ''} placeholder="Обычная / по карте / от 2 упаковок" /></Field>
      <Field label="Минимум упаковок для этой цены" help="Для «от 2 упаковок» укажите 2. Сложные акции 2+1 не поддерживаются."><input name="minPacks" type="number" min="1" max="100" step="1" required defaultValue={offer?.minPacks??1}/></Field>
    </div>
    <div><h4 className="section-title">Пищевая ценность на 100 г</h4><p className="help">{estimated ? 'Сейчас отмечены справочные или оценочные значения. Сверьте с этикеткой именно этого товара и снимите отметку ниже, если все значения взяты с неё.' : 'Сейчас отмечены значения с этикетки этого товара. Если подставляете справочные КБЖУ, включите отметку ниже.'}</p></div>
    <div className="form-grid">{(Object.keys(macroLabels) as Array<keyof typeof macroLabels>).map(key => <Field key={key} label={macroLabels[key]}><input type="number" min="0" max={key === 'kcal' ? 1000 : 100} step="0.1" value={macros[key]} required onChange={event => setMacros({ ...macros, [key]: Number(event.target.value) })} /></Field>)}</div>
    <label className="row"><input type="checkbox" checked={estimated} onChange={event => setEstimated(event.target.checked)} />КБЖУ справочные или оценочные, не подтверждены этикеткой</label>
    <div className="form-grid">
      <Field label="Цена проверена (время устройства)"><input name="observedAt" type="datetime-local" defaultValue={localDate(offer?.observedAt ?? now.toISOString())} required /></Field>
      <Field label="Действительна до (время устройства)"><input name="validUntil" type="datetime-local" defaultValue={localDate(offer?.validUntil ?? new Date(now.getTime() + 7 * 86400000).toISOString())} required /></Field>
      <Field label="Основание срока"><select name="expiryKind" defaultValue={offer?.expiryKind ?? 'freshness'}><option value="freshness">Срок свежести наблюдения</option><option value="promotion">Конец акции магазина</option></select></Field>
      <Field label="Статус проверки"><select value={status} onChange={event => setStatus(event.target.value as Offer['status'])}><option value="pending">На проверке — не участвует в расчёте</option><option value="confirmed">Подтверждено для Когалыма</option></select></Field>
      <Field label="Ссылка на источник (необязательно)"><input name="sourceUrl" type="url" pattern="https://.*" maxLength={2000} defaultValue={offer?.sourceUrl ?? ''} placeholder="https://…" /></Field>
      <Field label="Подтверждение и условия цены"><textarea name="evidence" defaultValue={offer?.evidence ?? ''} required maxLength={2000} rows={3} placeholder="Адрес магазина в Когалыме, чек/ценник, дата, нужна ли карта" /></Field>
    </div>
    <label className="row"><input name="localConfirmed" type="checkbox" defaultChecked={offer?.localConfirmed ?? false} required={status === 'confirmed'} />Я проверил(а), что цена и условия относятся к магазину в Когалыме</label>
    {error && <p className="inline-notice" role="alert">{error}</p>}
    <div className="row"><button className="button primary" disabled={busy} type="submit"><Check size={17} />{busy ? 'Сохраняем…' : offer ? 'Сохранить изменения' : 'Добавить цену'}</button></div>
  </form>;
}

function ImportPanel({ run, busy }: Pick<Props, 'run' | 'busy'>) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [fileKey, setFileKey] = useState(0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setResult('');
    try { const offers = parseOfferImport(text); await run('offers', { offers }); setResult(`Загружено предложений: ${offers.length}.`); setText(''); setFileKey(value => value + 1); }
    catch (caught) { setError(message(caught)); }
  }
  function template() {
    const example = [{ foodId: 'chicken', name: 'Филе куриное, пример структуры', storeId: '5ka', price: 230, packGrams: 600, macros: { kcal: 113, protein: 23.6, fat: 1.9, carbs: 0 }, observedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 7 * 86400000).toISOString(), sourceUrl: '', evidence: 'ЗАМЕНИТЕ: адрес, чек/ценник, дата и условия цены в Когалыме', priceCondition: 'Укажите условия цены', localConfirmed: false, nutritionEstimated: true, status: 'pending', demo: false }];
    const url = URL.createObjectURL(new Blob([JSON.stringify({ offers: example }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'edada-price-template.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <details className="panel"><summary><Upload size={18} /> Импорт JSON или CSV</summary><form className="stack" onSubmit={submit}>
    <p className="help">До 100 предложений, файл до 250 КБ. JSON: массив объектов или объект с массивом offers. CSV: запятая как разделитель, первая строка — заголовки, кавычки поддерживаются. Все строки проверяются сервером до сохранения: при ошибке весь импорт отклоняется.</p>
    <button type="button" className="button secondary" onClick={template}><Download size={16} />Скачать шаблон JSON</button>
    <Field label="Файл прайса"><input key={fileKey} type="file" accept=".json,.csv,application/json,text/csv" disabled={busy} onChange={async event => { setError(''); setResult(''); const file = event.target.files?.[0]; if (!file) return; if (file.size > 256000) { setError('Файл слишком большой: максимум 250 КБ.'); return; } try { setText(await file.text()); } catch { setError('Не удалось прочитать файл.'); } }} /></Field>
    <Field label="Содержимое JSON или CSV"><textarea rows={8} required value={text} onChange={event => setText(event.target.value)} placeholder="Вставьте прайс или выберите файл" spellCheck={false} /></Field>
    <p className="help">Поля CSV: foodId,name,storeId,price,packGrams,minPacks,kcal,protein,fat,carbs,observedAt,validUntil,sourceUrl,evidence,localConfirmed,nutritionEstimated,status,priceCondition. minPacks — необязательный минимум упаковок, по умолчанию 1. Числа — с точкой; логические значения — true / false; даты — ISO 8601 с часовым поясом. ID продуктов доступны в справочнике ниже.</p>
    {error && <p className="inline-notice" role="alert">{error}</p>}{result && <p className="inline-notice" role="status">{result}</p>}
    <button className="button primary" disabled={busy} type="submit"><Upload size={17} />{busy ? 'Проверяем…' : 'Проверить и импортировать'}</button>
  </form></details>;
}

export function CatalogPanel({ data, run, busy, demo }: Props & { demo: boolean }) {
  const [query, setQuery] = useState('');
  const [storeId, setStoreId] = useState('all');
  const [status, setStatus] = useState('all');
  const [newForm, setNewForm] = useState(0);
  const [demoOffers] = useState(() => getDemoOffers());
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setCheckedAt(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const offers = (demo ? demoOffers : data.offers.filter(offer => !offer.demo)).filter(offer =>
    (storeId === 'all' || offer.storeId === storeId) && (status === 'all' || (status === 'expired' ? Date.parse(offer.validUntil) < checkedAt : offer.status === status)) &&
    `${offer.name} ${FOODS.find(food => food.id === offer.foodId)?.name ?? ''}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
  return <div className="stack">
    <div className="split-header"><div><p className="muted">Цены и пищевая ценность</p><h2>Каталог продуктов</h2><p className="help">Фиксированный справочник из 20 продуктов. В расчёт реального меню идут только действующие цены, подтверждённые для Когалыма.</p></div><span className="tag">{offers.length} предложений</span></div>
    <p className="inline-notice">{demo ? 'ДЕМО · Все цены и фасовки примерные и вымышленные. Это не реальные предложения магазинов и не подтверждение наличия в Когалыме.' : 'Реальные данные · Добавляйте цены с чека или ценника либо проверяйте предложения из источников. Интернет-цены сначала попадают в очередь проверки.'}</p>
    {!demo && <><details className="panel"><summary><Plus size={18} /> Добавить цену вручную</summary><OfferForm key={newForm} run={run} busy={busy} onSaved={() => setNewForm(value => value + 1)} /></details><ImportPanel run={run} busy={busy} /></>}
    <section className="panel stack" aria-label="Предложения магазинов">
      <div className="form-grid"><Field label="Поиск продукта"><div className="row"><Search size={18} aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Название продукта или товара" /></div></Field><Field label="Магазин"><select value={storeId} onChange={event => setStoreId(event.target.value)}><option value="all">Все магазины</option><StoreOptions /></select></Field><Field label="Статус"><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">Все статусы</option><option value="confirmed">Подтверждено</option><option value="pending">На проверке</option><option value="expired">Срок истёк</option></select></Field></div>
      {!offers.length ? <div className="empty-state"><h3>{query || storeId !== 'all' || status !== 'all' ? 'Ничего не найдено' : 'Пока нет реальных цен'}</h3><p>{query || storeId !== 'all' || status !== 'all' ? 'Измените поиск или фильтры.' : 'Добавьте цену вручную, импортируйте прайс или настройте источник в разделе «Источники».'}</p></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Продукт и магазин</th><th scope="col">Цена / упаковка</th><th scope="col">КБЖУ на 100 г</th><th scope="col">Проверка и срок</th></tr></thead><tbody>{offers.map(offer => {
        const store = STORES.find(item => item.id === offer.storeId)!;
        const expired = Date.parse(offer.validUntil) < checkedAt;
        return <OfferRows key={offer.id} offer={offer} storeName={store.name} storeShort={store.short} storeColor={store.color} expired={expired} demo={demo} busy={busy} run={run} />;
      })}</tbody></table></div>}
    </section>
    <details className="panel"><summary>Справочник 20 продуктов · КБЖУ и ID для импорта</summary><p className="help">Справочные значения на 100 г сырой съедобной части. Они могут отличаться от этикетки товара; в реальном расчёте используются КБЖУ конкретного предложения.</p><div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Продукт / ID</th><th scope="col">Ккал</th><th scope="col">Б / Ж / У, г</th><th scope="col">Аллергены</th></tr></thead><tbody>{FOODS.map(food => <tr key={food.id}><td>{food.emoji} {food.name}<br /><code className="muted">{food.id}</code></td><td>{num(food.macros.kcal)}</td><td>{num(food.macros.protein)} / {num(food.macros.fat)} / {num(food.macros.carbs)}</td><td>{food.allergens.join(', ') || 'Не указаны в справочнике'}</td></tr>)}</tbody></table></div></details>
  </div>;
}

function OfferRows({ offer, storeName, storeShort, storeColor, expired, demo, busy, run }: { offer: Offer; storeName: string; storeShort: string; storeColor: string; expired: boolean; demo: boolean } & Pick<Props, 'run' | 'busy'>) {
  return <><tr><td><strong>{FOODS.find(food => food.id === offer.foodId)?.emoji} {offer.name}</strong><div className="row"><span className="store-mark" style={{ backgroundColor: storeColor }}>{storeShort}</span><span>{storeName}</span></div><small className="help">{offer.priceCondition || 'Условия цены не указаны'}</small></td>
    <td><strong>{rub(offer.price)}</strong><br /><span className="help">за {num(offer.packGrams)} г · {rub(offer.price / offer.packGrams * 1000)}/кг</span></td>
    <td>{num(offer.macros.kcal)} ккал<br /><small>Б {num(offer.macros.protein)} · Ж {num(offer.macros.fat)} · У {num(offer.macros.carbs)}</small><br /><span className="tag">{offer.nutritionEstimated ? 'Справочные КБЖУ' : 'КБЖУ с этикетки'}</span></td>
    <td><span className="tag">{demo ? 'Демо' : expired ? 'Срок истёк' : offer.status === 'pending' ? 'На проверке' : 'Подтверждено'}</span><br /><small className="help">Проверено: {date(offer.observedAt)}<br />До: {date(offer.validUntil)}<br />{offer.expiryKind === 'promotion' ? 'Срок акции' : 'Срок свежести наблюдения'}</small></td></tr>
    <tr><td colSpan={4}><details><summary>{!demo && offer.status === 'pending' ? 'Проверить город, условия и дату →' : demo ? 'Пояснение к примеру' : 'Источник и редактирование'}</summary><div className="stack"><p>{offer.evidence}</p>{offer.sourceUrl && <a href={offer.sourceUrl} target="_blank" rel="noopener noreferrer">{demo ? 'Сайт магазина — не источник этой примерной цены' : 'Открыть источник'} <ExternalLink size={13} /></a>}{!demo && <><OfferForm offer={offer} run={run} busy={busy} /><button type="button" className="button danger" disabled={busy} onClick={() => { void run('offers', { operation: 'delete', id: offer.id }).catch(swallow); }}><Trash2 size={15} />Удалить цену</button></>}</div></details></td></tr></>;
}

function SourceForm({ source, run, busy, onSaved }: { source?: Source; onSaved?: () => void } & Pick<Props, 'run' | 'busy'>) {
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); const fields = new FormData(event.currentTarget);
    try { await run('sources', { ...(source ? { id: source.id } : {}), storeId: String(fields.get('storeId')), url: String(fields.get('url')).trim(), label: String(fields.get('label')).trim(), enabled: fields.get('enabled') === 'on' }); onSaved?.(); }
    catch (caught) { setError(message(caught)); }
  }
  return <form className="stack" onSubmit={submit}><div className="form-grid"><Field label="Магазин"><select name="storeId" defaultValue={source?.storeId ?? '5ka'} required><StoreOptions /></select></Field><Field label="Название источника"><input name="label" defaultValue={source?.label ?? ''} maxLength={100} required placeholder="Например, каталог магазина на этой неделе" /></Field><Field label="Публичный HTTPS URL"><input type="url" name="url" defaultValue={source?.url ?? ''} pattern="https://.*" maxLength={2000} required placeholder="https://…" /></Field></div><label className="row"><input name="enabled" type="checkbox" defaultChecked={source?.enabled ?? true} />Использовать при обновлении</label>{error && <p role="alert" className="inline-notice">{error}</p>}<button type="submit" className="button primary" disabled={busy}>{source ? 'Сохранить источник' : 'Добавить источник'}</button></form>;
}

export function SourcesPanel({ data, run, busy }: Props) {
  const [formKey, setFormKey] = useState(0);
  const [refreshResult, setRefreshResult] = useState('');
  async function refresh() { try { const result = await run('refresh', {}); setRefreshResult(result?.message ?? 'Проверка завершена. Результаты по каждому источнику указаны ниже.'); } catch { /* run shows the error */ } }
  return <div className="stack"><div className="split-header"><div><p className="muted">Откуда берутся цены</p><h2>Источники для Когалыма</h2><p className="help">До трёх ваших ссылок на публичные страницы магазинов. Пятёрочка, Магнит и Светофор доступны как магазины справочника; автоматические источники для них ещё нужно добавить.</p></div><button className="button primary" disabled={busy || !data.sources.some(source => source.enabled)} onClick={() => { void refresh(); }}><RefreshCw size={17} />{busy ? 'Проверяем…' : 'Обновить цены сейчас'}</button></div>
    <div className="source-grid">{STORES.map(store=><article key={store.id} className="panel"><div className="row"><span className="store-mark" style={{background:store.color}}>{store.short}</span><h3>{store.name}</h3></div><p>{store.address}</p><p>{store.locationNote}</p><p><a href={store.locationSource} target="_blank" rel="noopener noreferrer">Адрес и источник ↗</a> · <a href={store.url} target="_blank" rel="noopener noreferrer">Сайт сети ↗</a></p></article>)}</div>
    <div className="inline-notice">Firecrawl получает свежую страницу; если подключён Gemini, модель Flash-Lite извлекает из неё данные. Цены поступают на проверку: подтвердите магазин в Когалыме, фасовку, условия и даты. До подтверждения они не участвуют в меню. Если КБЖУ на странице нет, справочные значения отмечаются отдельно.</div>
    {(refreshResult || data.refreshMessage) && <p className="inline-notice" role="status">{refreshResult || data.refreshMessage}</p>}
    {!data.sources.length && <div className="panel empty-state"><h3>Источники пока не настроены</h3><p>Добавьте ссылку на страницу цен магазина. Ключ для сборщика можно сохранить в «Настройках».</p></div>}
    {data.sources.map(source => <section className="panel stack" key={source.id}><div className="split-header"><div><h3>{source.label}</h3><p className="muted">{STORES.find(store => store.id === source.storeId)?.name}</p></div><label className="row"><input type="checkbox" checked={source.enabled} disabled={busy} onChange={event => { void run('sources', { id: source.id, storeId: source.storeId, url: source.url, label: source.label, enabled: event.target.checked }).catch(swallow); }} />{source.enabled ? 'Включён' : 'Выключен'}</label></div><a href={source.url} target="_blank" rel="noopener noreferrer">{source.url} <ExternalLink size={14} /></a><div className="row"><span className="help">Последняя попытка: {date(source.lastAttempt)}</span><span className="help">Успешно: {date(source.lastSuccess)}</span><span className="tag">{source.count ?? 0} извлечено при последнем успехе</span></div>{source.error && <p role="status" className="inline-notice">{source.error}</p>}<details><summary>Изменить источник</summary><SourceForm source={source} run={run} busy={busy} /></details><button className="button danger" disabled={busy} onClick={() => { void run('sources', { operation: 'delete', id: source.id }).catch(swallow); }}><Trash2 size={15} />Удалить источник</button></section>)}
    {data.sources.length < 3 ? <details className="panel" open={!data.sources.length}><summary><Plus size={17} /> Добавить источник · {data.sources.length}/3</summary><SourceForm key={formKey} run={run} busy={busy} onSaved={() => setFormKey(value => value + 1)} /></details> : <p className="help">Добавлены все три источника. Чтобы добавить другой, удалите или измените существующий.</p>}
  </div>;
}

export function SettingsPanel({ data, run, busy }: Props) {
  const settings = data.settings;
  const [geminiKey, setGeminiKey] = useState('');
  const [firecrawlKey, setFirecrawlKey] = useState('');
  const [clearGemini, setClearGemini] = useState(false);
  const [clearFirecrawl, setClearFirecrawl] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const modelList = useId();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice(''); const form = new FormData(event.currentTarget);
    try {
      await run('settings', { recipeModel: String(form.get('recipeModel')).trim(), extractionModel: String(form.get('extractionModel')).trim(), cadence: String(form.get('cadence')), ...(geminiKey.trim() ? { geminiKey: geminiKey.trim() } : {}), ...(firecrawlKey.trim() ? { firecrawlKey: firecrawlKey.trim() } : {}), clearGemini, clearFirecrawl });
      setGeminiKey(''); setFirecrawlKey(''); setClearGemini(false); setClearFirecrawl(false); setNotice('Настройки сохранены. Поля ключей очищены.');
    } catch (caught) { setError(message(caught)); }
  }
  async function loadModels() {
    setError(''); setNotice('');
    try { const result = await run('models', {}); setModels(result?.models ?? []); setNotice(`Доступных моделей: ${result?.models?.length ?? 0}. Список получен с сохранённым ключом Gemini.`); }
    catch (caught) { setError(message(caught)); }
  }
  return <div className="stack"><div><p className="muted">Подключения и обновления</p><h2>Настройки</h2><p className="help">Gemini предлагает рецепты и извлекает цены. Firecrawl помогает читать страницы источников.</p></div><form className="stack" onSubmit={submit}>
    <section className="panel stack"><h3><KeyRound size={20} /> Ключи сервисов</h3><p className="help">Секреты шифруются на сервере. Сохранённые ключи не возвращаются в браузер; поля ниже нужны только для замены. Ключи не сохраняются в хранилище браузера.</p><div className="form-grid"><Field label="Gemini API key" help={settings.geminiConfigured ? 'Ключ сохранён. Оставьте поле пустым, чтобы сохранить его.' : 'Ключ пока не добавлен.'}><input type="password" value={geminiKey} onChange={event => setGeminiKey(event.target.value)} autoComplete="new-password" spellCheck={false} maxLength={300} disabled={clearGemini} placeholder="Вставьте новый ключ Gemini" /></Field><Field label="Firecrawl API key" help={settings.firecrawlConfigured ? 'Ключ сохранён. Оставьте поле пустым, чтобы сохранить его.' : 'Ключ пока не добавлен.'}><input type="password" value={firecrawlKey} onChange={event => setFirecrawlKey(event.target.value)} autoComplete="new-password" spellCheck={false} maxLength={300} disabled={clearFirecrawl} placeholder="Вставьте новый ключ Firecrawl" /></Field></div><div className="row"><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Получить ключ в AI Studio <ExternalLink size={13} /></a><a href="https://www.firecrawl.dev/app/api-keys" target="_blank" rel="noopener noreferrer">Ключи Firecrawl <ExternalLink size={13} /></a></div><div className="row"><label className="row"><input type="checkbox" checked={clearGemini} onChange={event => { setClearGemini(event.target.checked); if (event.target.checked) setGeminiKey(''); }} />Удалить сохранённый ключ Gemini</label><label className="row"><input type="checkbox" checked={clearFirecrawl} onChange={event => { setClearFirecrawl(event.target.checked); if (event.target.checked) setFirecrawlKey(''); }} />Удалить сохранённый ключ Firecrawl</label></div></section>
    <section className="panel stack"><h3>Модели Gemini</h3><p className="help">Укажите ID вручную или получите список моделей, доступных вашему ключу. Названия gemini-3.8-flash и gemini-3.5-flash-lite — запрашиваемые модели; их доступность проверяется через API. Сначала сохраните новый ключ.</p><div className="form-grid"><Field label="Модель для рецептов"><input name="recipeModel" defaultValue={settings.recipeModel} list={modelList} pattern="[a-zA-Z0-9._\-]{1,100}" maxLength={100} required placeholder="gemini-3.8-flash" /></Field><Field label="Модель для извлечения цен"><input name="extractionModel" defaultValue={settings.extractionModel} list={modelList} pattern="[a-zA-Z0-9._\-]{1,100}" maxLength={100} required placeholder="gemini-3.5-flash-lite" /></Field></div><datalist id={modelList}>{[...new Map([{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }, { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite' }, ...models].map(model => [model.id, model])).values()].map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist><button type="button" className="button secondary" disabled={busy || !settings.geminiConfigured} onClick={() => { void loadModels(); }}><RefreshCw size={16} />Проверить и получить доступные модели</button></section>
    <section className="panel stack"><h3>Частота обновления цен</h3><Field label="Предпочтительное расписание"><select name="cadence" defaultValue={settings.cadence}><option value="daily">Ежедневно</option><option value="weekly">Раз в неделю</option><option value="manual">Только вручную</option></select></Field><p className="inline-notice">{settings.automationReady ? 'Сервис подтвердил установку расписания. Обновления используют выбранную частоту и включённые источники.' : 'Автоматическое расписание ещё не подтверждено сервисом. Выбор частоты сохранится как настройка; сейчас используйте «Обновить цены сейчас» в источниках.'}</p></section>
    {error && <p className="inline-notice" role="alert">{error}</p>}{notice && <p className="inline-notice" role="status">{notice}</p>}<div className="row"><button className="button primary" disabled={busy} type="submit"><Check size={17} />{busy ? 'Сохраняем…' : 'Сохранить настройки'}</button></div>
  </form></div>;
}


