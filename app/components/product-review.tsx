'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, CheckCheck, ExternalLink, Leaf, RotateCcw, ShieldCheck, Sprout } from 'lucide-react';
import { api } from '../../lib/client';
import { STORES } from '../../lib/catalog';
import { REVIEW_KINDS, type ReviewTask, type ReviewView } from '../../lib/product-review';
import type { Macros } from '../../lib/domain';
import './review-game.css';

const macroFields = [
  { key: 'kcal', label: 'Калории', unit: 'ккал', max: 1000 },
  { key: 'protein', label: 'Белки', unit: 'г', max: 100 },
  { key: 'fat', label: 'Жиры', unit: 'г', max: 100 },
  { key: 'carbs', label: 'Углеводы', unit: 'г', max: 100 },
] as const;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить. Попробуйте ещё раз.';
const safeSource = (value?: string) => { try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } };

type ReviewOperation = 'confirm' | 'skip' | 'exclude';
type ReviewAction = { operation: ReviewOperation; key: string; fingerprint: string; kind?: string; packGrams?: number; macros?: Macros; nutritionSourceUrl?: string; labelEvidence?: string; confirmed?: boolean };

export function ProductReviewPanel({ view, onChanged }: { view: ReviewView; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [last, setLast] = useState<{ key: string; name: string }>();
  const [taskType, setTaskType] = useState<'all' | ReviewTask['issue']>('all');
  const lock = useRef(false);
  const headingId = useId();
  const task = view.tasks.find(item => taskType === 'all' || item.issue === taskType);
  const sectionRef = useRef<HTMLElement>(null);
  const previousTask = useRef(task?.key);
  const { stats } = view;
  const goal = Math.max(1, stats.dailyGoal);

  useEffect(() => {
    if (previousTask.current !== task?.key) sectionRef.current?.querySelector<HTMLElement>('[data-review-focus]')?.focus();
    previousTask.current = task?.key;
  }, [task?.key]);

  async function act(action: ReviewAction, name: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setStatus('');
    try {
      await api('review', action);
      setLast({ key: action.key, name });
      setStatus(action.operation === 'confirm' ? 'Проверка сохранена. Продукт готов для расчётов.' : action.operation === 'exclude' ? 'Позиция исключена из продуктов.' : 'Карточка отложена. Можно вернуться к ней позже.');
      try { await onChanged(); } catch { setError('Изменение сохранено, но обновить список не удалось. Обновите страницу перед следующей проверкой.'); }
    } catch (caught) { setError(errorMessage(caught)); }
    finally { lock.current = false; setBusy(false); }
  }

  async function undo() {
    if (!last || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setStatus('');
    try {
      await api('review', { operation: 'undo', key: last.key });
      setLast(undefined); setStatus('Последнее действие отменено.');
      try { await onChanged(); } catch { setError('Отмена сохранена. Обновите страницу, чтобы увидеть актуальную очередь.'); }
    } catch (caught) { setError(errorMessage(caught)); }
    finally { lock.current = false; setBusy(false); }
  }

  return <section className="review-game" aria-labelledby={headingId} ref={sectionRef}>
    <header className="review-intro">
      <div><span className="review-kicker"><Sprout size={15} aria-hidden="true" /> ВАША БАЗА ПРОДУКТОВ</span><h2 id={headingId}>Один продукт — больше ясности.</h2><p>Сверяйте факты с этикеткой. Из проверенных продуктов получаются точные расчёты и новые блюда.</p></div>
      <div className="review-level"><Leaf size={22} aria-hidden="true" /><span><strong>Уровень {stats.level}</strong><small>{stats.xp} XP · ваш вклад</small></span></div>
    </header>

    <div className="review-progress-grid">
      <div className="review-daily"><div><strong>Небольшая цель на сегодня</strong><span>{stats.dailyDone} / {stats.dailyGoal}</span></div><progress aria-label="Проверено сегодня" value={Math.min(stats.dailyDone, goal)} max={goal} /><p>{stats.dailyDone >= goal ? 'Цель выполнена. Спасибо за аккуратную проверку!' : 'Пять минут или одна карточка — продолжайте в удобном темпе.'}</p></div>
      <div className="review-contribution"><span><CheckCheck size={17} aria-hidden="true" /><strong>{stats.verified}</strong> проверено</span><span><ShieldCheck size={17} aria-hidden="true" /><strong>{stats.excluded}</strong> исключено</span></div>
    </div>
    {stats.badges.length > 0 && <ul className="review-badges" aria-label="Ваши достижения">{stats.badges.map(badge => <li key={badge}><Sprout size={14} aria-hidden="true" />{badge}</li>)}</ul>}

    <div className="review-filter-bar"><label htmlFor={`${headingId}-type`}>Тип задания<select id={`${headingId}-type`} name="reviewTaskType" value={taskType} disabled={busy} onChange={event => setTaskType(event.target.value as typeof taskType)}><option value="all">Все</option><option value="nutrition">КБЖУ</option><option value="mass">Масса</option><option value="role">Тип продукта</option><option value="nonfood">Не пищевой товар</option></select></label><p>Выберите, что удобнее проверить сейчас. Ваш прогресс сохраняется для всех типов заданий.</p></div>

    <div className="review-status" role="status" aria-live="polite" aria-atomic="true">{status}</div>
    {error && <p className="review-error" role="alert">{error}</p>}
    {last && <button className="review-undo" type="button" onClick={undo} disabled={busy}><RotateCcw size={15} aria-hidden="true" />Отменить последнее действие<span className="review-visually-hidden">: {last.name}</span></button>}

    {task ? <ReviewTaskForm key={`${task.key}:${task.fingerprint}`} task={task} remaining={view.remaining} busy={busy} onAction={act} /> : taskType !== 'all' ? <div className="review-complete"><div><h3 tabIndex={-1} data-review-focus>В этом наборе нет заданий выбранного типа</h3><p>Можно выбрать другой тип или продолжить с любыми доступными карточками.</p><button className="review-button review-secondary review-filter-reset" type="button" onClick={() => setTaskType('all')}>Показать все типы</button></div></div> : <div className="review-complete"><span className="review-complete-icon"><Check size={30} aria-hidden="true" /></span><div><h3 tabIndex={-1} data-review-focus>На сегодня всё проверено</h3><p>В очереди пока нет новых карточек. Новые задания появятся после обновления каталога.</p></div></div>}
  </section>;
}

function ReviewTaskForm({ task, remaining, busy, onAction }: { task: ReviewTask; remaining: number; busy: boolean; onAction: (action: ReviewAction, name: string) => Promise<void> }) {
  const id = useId();
  const [kind, setKind] = useState(task.kind ?? '');
  const [packGrams, setPackGrams] = useState(String(task.candidate?.packGrams ?? task.packGrams ?? ''));
  const [macros, setMacros] = useState(() => Object.fromEntries(macroFields.map(({ key }) => [key, task.candidate?.macros?.[key] === undefined ? '' : String(task.candidate.macros[key])])) as Record<keyof Macros, string>);
  const [nutritionSourceUrl, setNutritionSourceUrl] = useState(task.candidate?.nutritionSourceUrl ?? '');
  const [labelEvidence, setLabelEvidence] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const storeName = STORES.find(store => store.id === task.storeId)?.name ?? task.storeId;
  const sourceUrl = safeSource(task.sourceUrl);
  const candidateUrl = safeSource(task.candidate?.nutritionSourceUrl ?? task.candidate?.sourceUrl);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget;
    const invalid: Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = [];
    for (const control of Array.from(form.elements)) {
      if ((control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) && !control.validity.valid) invalid.push(control);
    }
    for (const control of invalid) control.setAttribute('aria-invalid', 'true');
    if (invalid.length) { setError('Заполните обязательные поля и подтвердите сверку с этикеткой. Если данных нет, нажмите «Позже».'); invalid[0].focus(); return; }
    const numeric = Object.fromEntries(macroFields.map(({ key }) => [key, Number(macros[key])])) as Macros;
    if (numeric.protein + numeric.fat + numeric.carbs > 105) { setError('Сумма белков, жиров и углеводов на 100 г не может превышать 105 г. Перепроверьте этикетку.'); form.querySelector<HTMLInputElement>('[name="protein"]')?.focus(); return; }
    setError('');
    await onAction({ operation: 'confirm', key: task.key, fingerprint: task.fingerprint, kind, packGrams: Number(packGrams), macros: numeric, nutritionSourceUrl: nutritionSourceUrl.trim(), labelEvidence: labelEvidence.trim(), confirmed }, task.name);
  }

  return <article className="review-task">
    <header className="review-task-header"><span className="review-kicker">КАРТОЧКА ДЛЯ ПРОВЕРКИ</span><span className="review-queue">В очереди: {remaining}</span></header>
    <h3 tabIndex={-1} data-review-focus>{task.name}</h3>
    <div className="review-source-row"><span>{storeName}</span>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Открыть каталог <ExternalLink size={14} aria-hidden="true" /><span className="review-visually-hidden"> в новой вкладке</span></a>}</div>
    <div className="review-task-reason"><ShieldCheck size={19} aria-hidden="true" /><p><strong>Что нужно уточнить</strong><span>{task.reason || task.issue || 'Сверьте продукт, массу и полные КБЖУ с точным источником.'}</span></p></div>
    <form action="/api/review" method="post" noValidate onSubmit={submit} onInput={event => { const control = event.target; if ((control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) && control.validity.valid) control.removeAttribute('aria-invalid'); }}>
      <fieldset disabled={busy}><legend>01 <span>Что это за продукт</span></legend>
        <div className="review-identity-fields"><label htmlFor={`${id}-kind`}>Кулинарная категория *<select id={`${id}-kind`} name="kind" value={kind} onChange={event => setKind(event.target.value)} required><option value="">Выберите категорию</option>{REVIEW_KINDS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label htmlFor={`${id}-grams`}>Масса съедобного продукта, г *<input id={`${id}-grams`} name="packGrams" type="number" inputMode="decimal" min="0.1" max="20000" step="any" value={packGrams} onChange={event => setPackGrams(event.target.value)} aria-describedby={`${id}-mass-help`} required /></label></div>
        <p className="review-help" id={`${id}-mass-help`}>Только масса, прямо указанная для съедобного продукта. Не переводите миллилитры или штуки в граммы и не оценивайте массу без костей, кожуры или жидкости.</p>
      </fieldset>
      <fieldset disabled={busy}><legend>02 <span>Пищевая ценность на 100 г</span></legend><p className="review-help" id={`${id}-macro-help`}>Все четыре значения обязательны. Ноль вводите только тогда, когда он указан в источнике. Данные нужны до приготовления.</p>
        <div className="review-macro-fields">{macroFields.map(({ key, label, unit, max }) => <label key={key} htmlFor={`${id}-${key}`}>{label}<span className="review-input-unit"><input id={`${id}-${key}`} name={key} type="number" min="0" max={max} step="any" inputMode="decimal" value={macros[key]} onChange={event => setMacros(current => ({ ...current, [key]: event.target.value }))} aria-describedby={`${id}-macro-help`} required /><span>{unit}</span></span></label>)}</div>
      </fieldset>
      <fieldset disabled={busy}><legend>03 <span>Где вы сверили факты</span></legend>
        {task.candidate && <div className="review-candidate"><span>Найденный вариант: <strong>{task.candidate.productName}</strong>. Предзаполнение нужно проверить.</span>{candidateUrl && <a href={candidateUrl} target="_blank" rel="noopener noreferrer">Посмотреть источник <ExternalLink size={13} aria-hidden="true" /><span className="review-visually-hidden"> в новой вкладке</span></a>}</div>}
        <label htmlFor={`${id}-source`}>Ссылка на точный продукт с КБЖУ *<input id={`${id}-source`} name="nutritionSourceUrl" type="url" maxLength={2000} autoCapitalize="off" autoCorrect="off" spellCheck={false} value={nutritionSourceUrl} onChange={event => setNutritionSourceUrl(event.target.value)} placeholder="https://…" required /></label>
        <label htmlFor={`${id}-evidence`}>Что указано на этикетке *<textarea id={`${id}-evidence`} name="labelEvidence" minLength={12} maxLength={1500} rows={3} value={labelEvidence} onChange={event => setLabelEvidence(event.target.value)} placeholder="Название и вариант продукта, масса и строка КБЖУ на 100 г" aria-describedby={`${id}-evidence-help`} required /></label>
        <p className="review-help" id={`${id}-evidence-help`}>Подтверждайте именно этот бренд, жирность, вкус и упаковку. Данные похожего продукта не подходят.</p>
        <label className="review-confirm"><input type="checkbox" name="confirmed" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required /><span>Я сверил(а) точный продукт, массу и все КБЖУ с источником. Значения не оценены на глаз.</span></label>
      </fieldset>
      {error && <p className="review-error" role="alert">{error}</p>}
      <div className="review-submit-row"><button className="review-button review-primary" type="submit" disabled={busy}><Check size={17} aria-hidden="true" />{busy ? 'Сохраняем…' : 'Подтвердить продукт'}<ArrowRight size={17} aria-hidden="true" /></button><span>Ваш вклад появится после сохранения</span></div>
    </form>
    <footer className="review-task-footer"><div><strong>Не хватает данных?</strong><p>Отложите карточку. Лучше пропустить, чем угадывать.</p></div><div className="review-secondary-actions"><button className="review-button review-secondary" type="button" disabled={busy} onClick={() => onAction({ operation: 'skip', key: task.key, fingerprint: task.fingerprint }, task.name)}>Позже</button><button className="review-button review-text-button" type="button" disabled={busy} onClick={() => onAction({ operation: 'exclude', key: task.key, fingerprint: task.fingerprint }, task.name)}>Это не продукт</button></div></footer>
  </article>;
}
