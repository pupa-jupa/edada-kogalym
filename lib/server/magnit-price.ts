import type {Source} from '../domain';
import {magnitPriceUrl,parseMagnitPrice,type MagnitPriceMetadata} from '../magnit-price';
import type {UserState} from './state';
import {apiKey} from './providers';

/** Keeps the selected shop/channel intact; Firecrawl is transport only, with no AI calls. */
export async function collectMagnitPrice(state:UserState,source:Source){
 if(!magnitPriceUrl(source.url)||source.storeId!=='magnit')throw new Error('Нет прямого адаптера для этой карточки Магнита');
 let directError='';
 try{
  const response=await fetch(source.url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; Edada/0.4)','Accept':'text/html'},redirect:'manual',signal:AbortSignal.timeout(8000)});
  if(!response.ok){await response.body?.cancel();throw new Error(`HTTP ${response.status}`);}
  const row=parseMagnitPrice(await response.text(),source,{url:response.url});
  return {listings:[row],transport:'direct',pageCount:1,complete:true,warning:undefined};
 }catch(error){directError=error instanceof Error?error.message:'Ошибка страницы';}
 const key=await apiKey(state,'firecrawl');
 if(!key)throw new Error(`Прямой сбор Магнита не выполнен (${directError}). Для резервного сбора нужен ключ Firecrawl. Прежняя цена сохранена.`);
 const response=await fetch('https://api.firecrawl.dev/v2/scrape',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({url:source.url,maxAge:0,formats:['html','markdown'],onlyMainContent:false,excludeTags:['script','style','svg','picture'],timeout:25000}),signal:AbortSignal.timeout(30000)});
 if(!response.ok){await response.body?.cancel();throw new Error(`Firecrawl: HTTP ${response.status}. Прежняя цена Магнита сохранена.`);}
 const data=await response.json() as {success?:boolean;data?:{html?:string;metadata?:MagnitPriceMetadata}};
 if(data.success===false||typeof data.data?.html!=='string'||!data.data.metadata||data.data.metadata.statusCode!==200)throw new Error('Firecrawl не подтвердил HTML и метаданные карточки Магнита');
 const row=parseMagnitPrice(data.data.html,source,data.data.metadata);
 return {listings:[row],transport:'firecrawl',pageCount:1,complete:true,warning:undefined};
}
