import {parseProshoper,getProshoperPages,parseProshoperFragment} from '../proshoper';
import {apiKey} from './providers';
import type {Source} from '../domain';
import type {UserState} from './state';
export const directCatalog=(url:string)=>/^https:\/\/proshoper\.ru\/kogalym\/actions\/[a-z0-9-]+\/?$/i.test(url);
export async function collectCatalog(state:UserState,source:Source){
  if(!directCatalog(source.url))throw new Error('Для этого источника нет прямого адаптера');
  const deadline=Date.now()+90000;const key=await apiKey(state,'firecrawl');
  async function firecrawl(url:string){
    if(!key)throw new Error('Для резервного сбора сервером нужен ключ Firecrawl');
    for(let attempt=0;attempt<2;attempt++){
      const remaining=deadline-Date.now();if(remaining<1000)throw new Error('Лимит времени обхода');
      const response=await fetch('https://api.firecrawl.dev/v2/scrape',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({url,maxAge:0,formats:['html'],onlyMainContent:false,excludeTags:['script','style','picture','svg'],timeout:Math.min(25000,remaining-100)}),signal:AbortSignal.timeout(Math.min(30000,remaining))});
      if(!response.ok){const status=response.status;const wait=Math.min(10000,Math.max(2000,Number(response.headers.get('Retry-After')??2)*1000||2000));await response.body?.cancel();if(status===429&&attempt===0&&deadline-Date.now()>wait+5000){await new Promise(resolve=>setTimeout(resolve,wait));continue;}throw new Error(`Firecrawl: HTTP ${status}`);}
      const data=await response.json() as {success?:boolean;data?:{html?:string}};if(data.success===false||typeof data.data?.html!=='string')throw new Error('Firecrawl не вернул HTML');return data.data.html;
    }
    throw new Error('Firecrawl временно ограничил запросы');
  }
  let html='';let directError='';let transport='direct';let parsed:ReturnType<typeof parseProshoper>|undefined;
  try{
    const response=await fetch(source.url,{headers:{'User-Agent':'Edada/0.2 (+https://eda-da-kogalym.social-grape-1472.chatgpt.site)','Accept':'text/html'},redirect:'manual',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    html=await response.text();if(html.length>2500000)throw new Error('Страница превышает лимит размера');
    parsed=parseProshoper(html,source);if(!parsed.length)throw new Error('Карточки не найдены: структура страницы могла измениться');
  }catch(error){directError=error instanceof Error?error.message:'Ошибка источника';html='';parsed=undefined;}
  if(!html){
    if(!key)throw new Error(`Прямой сбор не выполнен (${directError}). Сохранённые данные не удалены. Для резервного сбора сервером нужен ключ Firecrawl.`);
    transport='firecrawl';
    html=await firecrawl(source.url);
  }
  const listings=parsed??parseProshoper(html,source);if(!listings.length)throw new Error('Карточки не найдены. Прежние данные сохранены; проверьте структуру страницы.');
  const byId=new Map(listings.map(row=>[row.id,row]));const queue=getProshoperPages(html,source);const seen=new Set<string>();const errors:string[]=[];let pageCount=1;
  while(queue.length&&seen.size<24&&Date.now()<deadline){
    const jobs=queue.splice(0,Math.min(1,24-seen.size)).filter(job=>{if(seen.has(job.url))return false;seen.add(job.url);return true;});
    await Promise.all(jobs.map(async job=>{try{
      let fragment:string;
      if(transport==='firecrawl')fragment=await firecrawl(job.url);else{
        const response=await fetch(job.url,{headers:{'User-Agent':'Edada/0.2 (+https://eda-da-kogalym.social-grape-1472.chatgpt.site)'},redirect:'manual',signal:AbortSignal.timeout(Math.min(8000,Math.max(1,deadline-Date.now())))});
        if(!response.ok){fragment=await firecrawl(job.url);transport='firecrawl';}else fragment=await response.text();
      }
      if(fragment.length>2500000)throw new Error('Размер страницы превышен');
      const rows=parseProshoperFragment(fragment,source,job);if(!rows.length)throw new Error('Дополнительная страница не вернула карточки');for(const row of rows)byId.set(row.id,row);
      queue.push(...getProshoperPages(fragment,source,job).filter(next=>!seen.has(next.url)));pageCount++;
    }catch(error){errors.push(error instanceof Error?error.message:'Ошибка дополнительной страницы');}}));
  }
  const complete=queue.length===0&&errors.length===0;return {listings:[...byId.values()],transport,pageCount,complete,warning:complete?undefined:`Получена часть каталога (${pageCount} стр.). ${errors[0]??'Достигнут лимит обхода 24 дополнительных страниц / 90 секунд.'}`};
}
