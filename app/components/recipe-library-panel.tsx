'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Check, Plus, Sparkles } from 'lucide-react';
import { api } from '../../lib/client';
import type { RecipeLibraryView } from '../../lib/client';
import './review-game.css';

export function RecipeLibraryPanel({ view, configured, onChanged }: { view?: RecipeLibraryView; configured: boolean; onChanged: () => Promise<void> }) {
  const id = useId();
  const [busy, setBusy] = useState<'settings' | 'fill'>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const lock = useRef(false);
  const eligible = view?.eligibleFoods ?? 0;
  const covered = view?.coveredFoods ?? 0;
  const awaitingGeneration = view ? Math.max(0, view.pendingFoods - view.needsReview - view.failedFoods) : 0;
  const limitReached = Boolean(view && view.dailyUsed >= view.dailyLimit);

  async function run(operation: 'settings' | 'fill', enabled?: boolean, dailyLimit?: number) {
    if (lock.current) return;
    lock.current = true; setBusy(operation); setError(''); setStatus('');
    try {
      const result = await api<{ message?: string }>('recipes', { operation, ...(operation === 'settings' ? { enabled, ...(dailyLimit === undefined ? {} : { dailyLimit }) } : {}) });
      setStatus(dailyLimit === undefined ? result.message ?? (operation === 'settings' ? enabled ? 'Автоматическое пополнение включено.' : 'Автоматическое пополнение приостановлено.' : 'Пакет обработан. Библиотека обновлена.') : `Лимит сохранён: ${dailyLimit} запросов Gemini в сутки.`);
      try { await onChanged(); } catch { setError('Изменения сохранены. Обновите страницу, чтобы увидеть актуальное покрытие.'); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось обновить библиотеку. Попробуйте ещё раз.'); }
    finally { lock.current = false; setBusy(undefined); }
  }

  return <section className="recipe-library" aria-labelledby={`${id}-heading`}>
    <header className="library-heading"><span className="library-icon"><BookOpen size={22} aria-hidden="true" /></span><div><span className="review-kicker">ИЗ ПРОВЕРЕННЫХ ПРОДУКТОВ</span><h2 id={`${id}-heading`}>Библиотека новых блюд</h2></div><span className="library-cache-label"><Check size={13} aria-hidden="true" />Для следующих подборов</span></header>
    <p className="library-description">ИИ придумывает рецепты один раз, а библиотека сохраняет их для следующих подборов. КБЖУ и стоимость приложение рассчитывает по проверенным продуктам и актуальным ценам.</p>
    {view ? <><div className="library-coverage"><div><strong>{covered}<span> / {eligible}</span></strong><span>продуктов уже есть в рецептах</span></div><span className="library-recipe-count">{view.generatedRecipes} <span>рецептов ИИ</span></span></div><progress max={Math.max(1, eligible)} value={Math.min(covered, eligible)} aria-label="Продукты, охваченные рецептами" /><p className="library-pending-total">Пока без рецепта <strong>{view.pendingFoods}</strong></p><div className="library-queue"><span><i aria-hidden="true" />Ожидают генерации <strong>{awaitingGeneration}</strong></span>{view.failedFoods > 0 && <span>Повтор генерации <strong>{view.failedFoods}</strong></span>}<span>Нужна проверка <strong>{view.needsReview}</strong></span></div></> : <p className="review-help">Покрытие появится после загрузки библиотеки.</p>}
    <div className="library-controls"><label className="library-toggle" htmlFor={`${id}-enabled`}><input id={`${id}-enabled`} type="checkbox" name="recipeLibraryEnabled" checked={view?.enabled ?? false} disabled={!view || Boolean(busy)} onChange={event => run('settings', event.target.checked)} /><span><strong>Пополнять автоматически</strong><small>Новые проверенные продукты получают рецепты постепенно.</small></span></label><button className="review-button review-primary" type="button" disabled={!view || !configured || Boolean(busy) || view.running || !view.pendingFoods || limitReached} onClick={() => run('fill')}><Plus size={17} aria-hidden="true" />{busy === 'fill' || view?.running ? 'Создаём рецепты…' : 'Создать новые рецепты'}</button></div>
    <DailyLimitForm key={view?.dailyLimit ?? 40} limit={view?.dailyLimit ?? 40} disabled={!view || Boolean(busy)} onSave={value => run('settings', view?.enabled ?? false, value)} />
    <div className="library-footnote"><Sparkles size={16} aria-hidden="true" /><p>{!configured ? 'Для новых рецептов подключите Gemini в настройках. Сохранённая библиотека остаётся доступной.' : limitReached ? 'Дневной лимит создания использован. Сохранённые рецепты доступны для подбора.' : view?.pendingFoods === 0 ? 'Все подходящие продукты охвачены. Библиотека готова к подбору меню.' : 'Кнопка создаёт один пакет рецептов. При обычном подборе меню приложение тоже использует библиотеку и пополняет её по запросу дополнительных вариантов.'}{view && <span> Дневной лимит: {view.dailyUsed} / {view.dailyLimit}.</span>}</p></div>
    {view?.message && <p className="library-server-note">{view.message}</p>}
    <div className="library-status" role="status" aria-live="polite" aria-atomic="true">{status}</div>
    {error && <p className="review-error" role="alert">{error}</p>}
  </section>;
}

function DailyLimitForm({ limit, disabled, onSave }: { limit: number; disabled: boolean; onSave: (value: number) => Promise<void> }) {
  const id = useId();
  const [draft, setDraft] = useState(String(limit));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    await onSave(Number(draft));
  }
  return <form className="library-limit-form" action="/api/recipes" method="post" onSubmit={submit}>
    <fieldset disabled={disabled}><label htmlFor={`${id}-limit`}>Запросов Gemini в сутки<input id={`${id}-limit`} name="dailyLimit" type="number" min={1} max={96} step={1} inputMode="numeric" value={draft} onChange={event => setDraft(event.target.value)} aria-describedby={`${id}-help`} required /></label><button className="review-button review-secondary" type="submit">Сохранить лимит</button></fieldset>
    <p className="library-limit-help" id={`${id}-help`}>От 1 до 96. Каждая попытка генерации, в том числе неудачная и запрос к запасной модели, расходует лимит. Изменение применяется по кнопке «Сохранить лимит».</p>
  </form>;
}
