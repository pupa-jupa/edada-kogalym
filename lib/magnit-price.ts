import type {CatalogListing} from './proshoper.ts';
import {parseMass} from './product-enrichment.ts';
type Source={id:string;storeId:string;url:string};
export type MagnitPriceMetadata=Record<string,unknown>;
/** Price collection is allowed only for an explicitly selected delivery shop/channel. */
export function magnitPriceUrl(value:string):{url:string;productId:string;shopCode:string}|undefined{
 try{
  const url=new URL(value),productId=url.pathname.match(/^\/product\/(\d+)(?:[-_][^/]+)?\/?$/)?.[1];
  if(url.origin!=='https://magnit.ru'||url.username||url.password||url.hash||!productId)return;
  const allowed=new Set(['shopCode','shopType','catalogType','source']);
  if([...url.searchParams.keys()].some(key=>!allowed.has(key)||url.searchParams.getAll(key).length!==1))return;
  const shopCode=url.searchParams.get('shopCode')??'';
  // This other-city shop is used solely by the nutrition reference adapter.
  if(!/^\d+$/.test(shopCode)||shopCode==='992301'||url.searchParams.get('shopType')!=='express'||url.searchParams.get('catalogType')!=='2')return;
  return {url:url.href,productId,shopCode};
 }catch{return;}
}
type Node={tag:string;attrs:Record<string,string>;children:Array<Node|string>};
const decode=(value:string)=>value.replace(/&(?:amp|quot|apos|nbsp|lt|gt|#(\d+)|#x([0-9a-f]+));/gi,(entity,decimal:string,hex:string)=>decimal||hex?String.fromCodePoint(Math.min(0x10ffff,parseInt(decimal||hex,decimal?10:16))):({'&amp;':'&','&quot;':'"','&apos;':"'",'&nbsp;':' ','&lt;':'<','&gt;':'>'}[entity.toLowerCase()]??entity));
function tree(html:string):Node{
 const root:Node={tag:'root',attrs:{},children:[]},stack=[root],voids=new Set(['meta','link','img','br','hr','input','source','area','wbr']);
 const clean=html.replace(/<!--[\s\S]*?-->|<(script|style|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
 for(const part of clean.matchAll(/<\/?([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)/gi)){
  if(part[3]!==undefined){stack.at(-1)!.children.push(decode(part[3]));continue;}
  const tag=part[1].toLowerCase();
  if(part[0].startsWith('</')){for(let i=stack.length-1;i>0;i--)if(stack[i].tag===tag){stack.length=i;break;}continue;}
  const attrs:Record<string,string>={};for(const attr of part[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g))attrs[attr[1].toLowerCase()]=decode(attr[2]??attr[3]??attr[4]??'');
  const node:Node={tag,attrs,children:[]};stack.at(-1)!.children.push(node);if(!voids.has(tag)&&!part[2].endsWith('/'))stack.push(node);
 }
 return root;
}
const text=(node:Node):string=>node.children.map(child=>typeof child==='string'?child:text(child)).join(' ').replace(/\s+/g,' ').trim();
function all(node:Node):Node[]{return node.children.flatMap(child=>typeof child==='string'?[]:[child,...all(child)]);}
const hasClass=(node:Node,name:string)=>(node.attrs.class??'').split(/\s+/).includes(name);
const normalize=(value:string)=>value.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase('ru');
function one(nodes:Node[],description:string):Node{if(nodes.length!==1)throw new Error(`Магнит: не подтверждён основной блок ${description}`);return nodes[0];}
function metadataText(metadata:MagnitPriceMetadata,nodes:Node[],field:'title'|'description'):string{
 const keys=field==='title'?['title','ogTitle','og:title']:['description','ogDescription','og:description'];
 const supplied=keys.map(key=>metadata[key]).find(value=>typeof value==='string'&&value.trim());if(typeof supplied==='string')return decode(supplied);
 const node=field==='title'?nodes.find(node=>node.tag==='title'):nodes.find(node=>node.tag==='meta'&&node.attrs.name==='description');
 return node?(field==='title'?text(node):node.attrs.content??''):'';
}
/** Uses only main PDP controls, never recommendations, cached reference prices, or AI. */
export function parseMagnitPrice(html:string,source:Source,metadata:MagnitPriceMetadata,now=new Date()):CatalogListing{
 const selected=magnitPriceUrl(source.url);if(!selected||source.storeId!=='magnit')throw new Error('Магнит: нужен явный магазин и канал экспресс-доставки');
 if(!Number.isFinite(now.getTime())||html.length>3_000_000)throw new Error('Магнит: недопустимый снимок страницы');
 if(typeof metadata.url!=='string')throw new Error('Магнит: конечный URL страницы не подтверждён');
 for(const key of ['url','sourceURL','canonicalURL','canonicalUrl','canonical']){
  const value=metadata[key];if(value===undefined)continue;
  const actual=typeof value==='string'?magnitPriceUrl(value):undefined;
  if(!actual||actual.productId!==selected.productId||actual.shopCode!==selected.shopCode)throw new Error('Магнит: конечная страница потеряла или изменила товар, магазин или канал');
 }
 if(metadata.statusCode!==undefined&&metadata.statusCode!==200)throw new Error('Магнит: конечная страница не подтверждена успешным ответом');
 const nodes=all(tree(html)),title=metadataText(metadata,nodes,'title'),description=metadataText(metadata,nodes,'description');
 const city=/(?:^|[^а-я])Когалым(?:$|[^а-я])/iu,address=/(?:улица|ул\.|проезд|проспект|пр-т|переулок|пер\.|шоссе|набережная|бульвар|б-р|микрорайон|мкр\.).{1,140}\d/iu;
 if(!city.test(title)||!city.test(description)||!address.test(title)||!address.test(description))throw new Error('Магнит: метаданные не подтверждают адрес магазина в Когалыме');
 const primary=one(nodes.filter(node=>hasClass(node,'unit-product-details')),'товара');
 const offer=one(all(primary).filter(node=>hasClass(node,'unit-product-details__offer')),'предложения');
 const name=text(one(all(offer).filter(node=>node.tag==='h1'&&node.attrs['data-test-id']==='v-product-details-name'),'названия'));
 if(!name||name.length>300||!normalize(title).includes(normalize(name)))throw new Error('Магнит: название основного товара не совпадает с метаданными');
 const containers=all(offer).filter(node=>hasClass(node,'unit-product-details__price-container'));
 const priceNodes=containers.flatMap(container=>all(container).filter(node=>['v-product-detail-price-current','v-price'].includes(node.attrs['data-test-id'])));
 const amounts=priceNodes.map(node=>{const value=text(node).replace(/\s/g,'');if(!/^\d+(?:[.,]\d{1,2})?(?:₽|руб\.?)$/iu.test(value))throw new Error('Магнит: цена основного товара не распознана');return Number(value.replace(/(?:₽|руб\.?)$/iu,'').replace(',','.'));});
 const controls=containers.flatMap(all),stockText=containers.map(text).join(' '),outOfStock=/нет в наличии|товар недоступен|нет в продаже|закончился/iu.test(stockText);
 if((!amounts.length&&!outOfStock)||amounts.some(price=>!Number.isFinite(price)||price<=0||price>100000||price!==amounts[0]))throw new Error('Магнит: текущая цена отсутствует или неоднозначна');
 const canAdd=controls.some(node=>node.tag==='button'&&!('disabled' in node.attrs)&&node.attrs['aria-disabled']!=='true'&&/^(?:добавить\s+)?в корзину$/iu.test(text(node)));
 const availability=outOfStock?'out-of-stock':canAdd?'in-stock':'unknown',mass=parseMass(name),byKg=/(?:весовой|весовая|за\s*1\s*кг)/iu.test(name);
 const packText=name.match(/\d+(?:[.,]\d+)?\s*(?:кг|г|мл|л|шт\.?)(?![а-яa-z])/iu)?.[0];
 const observedAt=now.toISOString();
 return {id:`magnit:${selected.shopCode}:${selected.productId}`,sourceId:source.id,storeId:'magnit',locality:'store',expiryKind:'freshness',priceCondition:`Цена экспресс-доставки магазина ${selected.shopCode}. Цены на полке и в других каналах могут отличаться. Наличие подтверждено на момент проверки по основной кнопке покупки; уточните перед заказом.`,sourceUrl:source.url,name,price:amounts[0],packGrams:byKg?undefined:mass,packText,priceUnit:byKg?'kg':mass!==undefined||packText?'pack':'unknown',availability,observedAt,lastSeenAt:observedAt,validUntil:new Date(now.getTime()+86400000).toISOString(),localEvidence:`Официальная карточка Магнита, shopCode=${selected.shopCode}, shopType=express, catalogType=2: «${title}».`,evidence:`Магнит PDP ${selected.productId}, магазин ${selected.shopCode}, экспресс-доставка: «${name}»; ${amounts.length?`основная цена ${amounts[0].toFixed(2)} ₽`:'цена отсутствует'}; ${packText?`количество «${packText}»`:'масса не указана'}; ${availability==='in-stock'?'основная кнопка «Добавить в корзину»':availability==='out-of-stock'?'основной блок: нет в наличии':'наличие не подтверждено'}. Снимок действителен 24 часа для проверки свежести, это не срок акции.`};
}
