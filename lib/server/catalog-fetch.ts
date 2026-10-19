import {parseProshoper} from '../proshoper';
import {apiKey} from './providers';
import type {Source} from '../domain';
import type {UserState} from './state';
export const directCatalog=(url:string)=>/^https:\/\/proshoper\.ru\/kogalym\/actions\/[a-z0-9-]+\/?$/i.test(url);
export async function collectCatalog(state:UserState,source:Source){
  if(!directCatalog(source.url))throw new Error('Для этого источника нет прямого адаптера');
  let html='';let directError='';let transport='direct';let parsed:ReturnType<typeof parseProshoper>|undefined;
  try{
    const response=await fetch(source.url,{headers:{'User-Agent':'Edada/0.2 (+https://eda-da-kogalym.social-grape-1472.chatgpt.site)','Accept':'text/html'},redirect:'error',signal:AbortSignal.timeout(18000)});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    html=await response.text();if(html.length>2500000)throw new Error('Страница превышает лимит размера');
    parsed=parseProshoper(html,source);if(!parsed.length)throw new Error('Карточки не найдены: структура страницы могла измениться');
  }catch(error){directError=error instanceof Error?error.message:'Ошибка источника';html='';parsed=undefined;}
  if(!html){
    const key=await apiKey(state,'firecrawl');if(!key)throw new Error(`Прямой сбор не выполнен (${directError}). Сохранённые данные не удалены. Для резервного сбора сервером нужен ключ Firecrawl.`);
    transport='firecrawl';
    const response=await fetch('https://api.firecrawl.dev/v2/scrape',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({url:source.url,maxAge:0,formats:['html'],onlyMainContent:false,excludeTags:['script','style','picture','svg'],timeout:45000}),signal:AbortSignal.timeout(55000)});
    if(!response.ok)throw new Error(`Firecrawl: HTTP ${response.status}. Прежний каталог сохранён.`);
    const data=await response.json() as {success?:boolean;data?:{html?:string}};if(data.success===false||typeof data.data?.html!=='string')throw new Error('Firecrawl не вернул HTML каталога');html=data.data.html;
  }
  const listings=parsed??parseProshoper(html,source);if(!listings.length)throw new Error('Карточки не найдены. Прежние данные сохранены; проверьте структуру страницы.');
  return {listings,transport};
}
