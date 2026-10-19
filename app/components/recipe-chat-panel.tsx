'use client';

import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {ArrowUpRight,Check,MessageCircle,RotateCcw,Send,Sparkles} from 'lucide-react';
import {api} from '../../lib/client';
import {RECIPE_CHAT_MODEL,type RecipeChatView} from '../../lib/recipe-chat';
import type {SavedRecipe} from '../../lib/recipe-library';
import type {PlanInput} from '../../lib/domain';
import './recipe-chat.css';

type Props={configured:boolean;view?:RecipeChatView;planId?:string;input?:PlanInput;onChanged:()=>Promise<void>;onRecipes?:(recipes:SavedRecipe[])=>Promise<void>};
const starters=['Мне не нравится сочетание продуктов в меню. Помоги заменить.','Придумай другой завтрак с тем же бюджетом и белком.','Объясни, как приготовить блюдо из моего меню.'];
export function RecipeChatPanel({configured,view,planId,input:currentInput,onChanged,onRecipes}:Props){
 const id=useId(),[local,setLocal]=useState<RecipeChatView|null>(view??null),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[applying,setApplying]=useState(false);
 const pending=useRef(false),input=useRef<HTMLTextAreaElement>(null),bottom=useRef<HTMLDivElement>(null);
 const current=local??view,atLimit=!!current&&current.dailyUsed>=current.dailyLimit;
 useEffect(()=>{if(view)return;let active=true;api<RecipeChatView>('recipe-chat').then(result=>{if(active)setLocal(result);}).catch(()=>{if(active)setError('Не удалось загрузить диалог. Попробуйте открыть раздел снова.');});return()=>{active=false;};},[view]);
 useEffect(()=>{if(current?.messages.length)bottom.current?.scrollIntoView({block:'nearest'});},[current?.messages.length]);
 async function send(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(pending.current||!configured||atLimit||!draft.trim())return;
  pending.current=true;setBusy(true);setError('');setStatus('Gemini обдумывает ответ…');
  try{
   const result=await api<RecipeChatView>('recipe-chat',{message:draft.trim(),...(planId?{planId}:{}),...(currentInput?{input:currentInput}:{})});setLocal(result);
   if(result.error){setError(result.error);setStatus('');}else{setDraft('');setStatus(result.newRecipes?.length?`В библиотеку добавлено рецептов: ${result.newRecipes.length}.`:'Ответ готов.');}
   try{await onChanged();}catch{setError('Ответ сохранён, но остальные данные не обновились. Обновите страницу.');}
  }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось отправить сообщение.');setStatus('');}
  finally{pending.current=false;setBusy(false);input.current?.focus();}
 }
 async function reset(){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');
  try{const result=await api<RecipeChatView>('recipe-chat',{reset:true});setLocal(result);if(result.error)setError(result.error);else{setDraft('');setStatus('Начат новый диалог. Дневной расход запросов сохранён.');}}
  catch(cause){setError(cause instanceof Error?cause.message:'Не удалось начать новый диалог.');}
  finally{pending.current=false;setBusy(false);input.current?.focus();}
 }
 async function apply(){
  if(!onRecipes||!current?.newRecipes?.length||applying)return;setApplying(true);setError('');
  try{await onRecipes(current.newRecipes);setStatus('Меню подобрано с учётом новых рецептов.');}
  catch(cause){setError(cause instanceof Error?cause.message:'Не удалось подобрать меню. Рецепты сохранены в библиотеке.');}
  finally{setApplying(false);}
 }
 return <section className="recipe-chat" aria-labelledby={`${id}-title`}>
  <header className="recipe-chat-heading"><div className="recipe-chat-heading-main"><span className="recipe-chat-icon"><MessageCircle size={20} aria-hidden="true"/></span><div><span className="recipe-chat-kicker">ВКУС МОЖНО ОБСУДИТЬ</span><h2 id={`${id}-title`}>Поговорим о еде</h2></div></div><button className="recipe-chat-reset" type="button" onClick={reset} disabled={busy||applying||!current?.messages.length}><RotateCcw size={14} aria-hidden="true"/>Новый диалог</button></header>
  <p className="recipe-chat-intro">Не нравится сочетание, хочется другой завтрак или непонятен шаг? Расскажите помощнику — он учтёт проверенные продукты, бюджет и ваши цели.</p>
  <div className="recipe-chat-context"><Check size={14} aria-hidden="true"/>{planId?'Обсуждаем выбранное меню':'Учитываем текущие ограничения подбора'}<span>Бюджет и КБЖУ проверит подбор меню</span></div>
  {!current?.messages.length?<div className="recipe-chat-starters"><p>Можно начать так</p>{starters.map(text=><button key={text} type="button" disabled={busy||!configured} onClick={()=>{setDraft(text);input.current?.focus();}}>{text}<ArrowUpRight size={15} aria-hidden="true"/></button>)}</div>:<div className="recipe-chat-log" role="log" aria-label="Диалог о рецептах" aria-live="polite" aria-relevant="additions text" tabIndex={0}>{current.messages.map(message=><article key={message.id} className={`recipe-chat-message recipe-chat-${message.role}`}><span className="recipe-chat-speaker">{message.role==='user'?'Вы':'Помощник'}</span><p>{message.text}</p>{!!message.recipeIds?.length&&<span className="recipe-chat-saved"><Check size={13} aria-hidden="true"/>Проверенные рецепты в библиотеке: {message.recipeIds.length}</span>}{!!message.sources?.length&&<ul className="recipe-chat-sources" aria-label="Источники ответа">{message.sources.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}<ArrowUpRight size={12} aria-hidden="true"/></a></li>)}</ul>}</article>)}<div ref={bottom}/></div>}
  {!!current?.newRecipes?.length&&<div className="recipe-chat-results"><span><Sparkles size={15} aria-hidden="true"/>Варианты прошли проверку состава</span><ul>{current.newRecipes.map(entry=><li key={entry.recipe.id}>{entry.recipe.emoji} {entry.recipe.name}<small>{entry.recipe.minutes} мин</small></li>)}</ul>{onRecipes&&<button className="recipe-chat-apply" type="button" disabled={busy||applying} onClick={apply}>{applying?'Подбираем меню…':'Подобрать меню с новыми рецептами'}<ArrowUpRight size={16} aria-hidden="true"/></button>}</div>}
  <form className="recipe-chat-form" action="/api/recipe-chat" method="post" onSubmit={send}>
   <label htmlFor={`${id}-message`}>Что хочется изменить или узнать?</label>
   <textarea ref={input} id={`${id}-message`} name="message" rows={3} maxLength={2000} required value={draft} disabled={!configured||busy||applying||atLimit} onChange={event=>setDraft(event.target.value)} placeholder="Например: хочу несладкий завтрак без рыбы, но с тем же количеством белка" aria-describedby={`${id}-help ${id}-limit`} onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}}}/>
   <div className="recipe-chat-form-bottom"><small id={`${id}-help`}>До 2000 символов · Ctrl / ⌘ + Enter — отправить</small><button type="submit" disabled={!configured||busy||applying||atLimit}><Send size={15} aria-hidden="true"/>{busy?'Обдумываем…':'Отправить'}</button></div>
  </form>
  <p className="recipe-chat-limit" id={`${id}-limit`}>{!configured?'Подключите Gemini в настройках.':atLimit?'Лимит диалога на сегодня использован. Он обновится в полночь по времени Когалыма.':`Запросы диалога сегодня: ${current?.dailyUsed??0} / ${current?.dailyLimit??20}. Каждая попытка, в том числе неудачная, расходует отдельный лимит диалога.`}</p>
  <details className="recipe-chat-model"><summary>Модель и расход</summary><p>{current?.model??RECIPE_CHAT_MODEL} · рассуждение high (максимум). Токены: вход {current?.inputTokens??0}, ответ {current?.outputTokens??0}, рассуждение {current?.thinkingTokens??0}. История сохраняет последние 24 сообщения в пределах объёма контекста.</p></details>
  <div className="recipe-chat-status" role="status" aria-live="polite" aria-atomic="true">{status}</div>
  {error&&<p className="recipe-chat-error" role="alert">{error}</p>}
 </section>;
}
