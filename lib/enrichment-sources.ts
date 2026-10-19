import {macrosSchema} from './validation.ts';
import {parseMass,type ProductCandidate} from './product-enrichment.ts';

// A deliberate source policy: external pages supply characteristics, never a local price.
export const PRODUCT_HOSTS=['magnit.ru','5ka.ru','perekrestok.ru','uvelka.ru','prostokvashino.ru','makfa.ru','miratorg.ru','mistral.ru','lenta.com','vkusvill.ru','auchan.ru','metro-cc.ru','brl.by','savushkin.by','danone.ru','actibio-club.ru','selo-zelenoe.ru','a-yabloko.ru','metropolis-online.ru','epind.com','tsar.ru','rusagrogroup.ru'];
export function allowedProductUrl(value:string):boolean{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&PRODUCT_HOSTS.some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}}
export function searchWords(name:string):string{return name.normalize('NFKC').replace(/\d+(?:[.,]\d+)?\s*(?:кг|мг|г|мл|л|шт|%)(?=\s|[,.;]|$)/giu,' ').replace(/[^\p{L}\p{N}\s-]/gu,' ').replace(/\s+/g,' ').trim().slice(0,200);}

/** Parse explicit label/value pairs from the MAIN product, with no model-invented fields. */
export function parseProductMarkdown(markdown:string,url:string,now=new Date()):ProductCandidate|null{
  if(!allowedProductUrl(url))return null;
  const main=markdown.split(/\n#{1,4}\s*(?:Рекомендуем|Похожие(?: товары)?|С этим товаром|Попробуйте|Вам может понравиться|Отзывы)/iu)[0].slice(0,45000);
  const heading=main.match(/^#\s+([^\n]{4,400})/m)?.[1]?.replace(/\\([*])/g,'$1').trim();if(!heading)return null;
  const found=/на\s*100\s*г(?:рамм)?(?=\s|[.,:]|$)/iu.exec(main);if(!found)return null;
  const source=main.slice(found.index,found.index+1200);
  if(/^[\s\S]{0,100}(?:готового|приготовленного|после приготовления|сухого остатка|основного продукта|без заливки|без жидкости)/iu.test(source))return null;
  const block=source.split(/(?:Подробнее о товаре|Состав|Способ приготовления|Условия хранения|\n\s*#{1,4}\s)/iu)[0];
  const number='(\\d+(?:[.,]\\d+)?)';
  const read=(label:string)=>{
    const match=block.match(new RegExp(label+'\\s*(?:[,;:]?\\s*г\\.?\\s*)?[:–—-]?\\s*'+number,'iu'));
    return match?Number(match[1].replace(',','.')):undefined;
  };
  const kcal=read('ккал')??(()=>{const m=block.match(/(\d+(?:[.,]\d+)?)\s*ккал/iu);return m?Number(m[1].replace(',','.')):undefined;})();
  const parsed=macrosSchema.safeParse({kcal,protein:read('белки'),fat:read('жиры'),carbs:read('углеводы')});if(!parsed.success)return null;
  const quantity=main.match(/(?:Масса\s*нетто|Вес\s*нетто)\s*[:–—-]?\s*(\d+(?:[.,]\d+)?\s*(?:кг|г))/iu)?.[1];
  const packGrams=parseMass(heading)??(quantity?parseMass(quantity):undefined);
  const brand=main.match(/(?:^|\n)Бренд\s*:?\s*([^\n]{2,100})/iu)?.[1]?.trim()??(new URL(url).hostname==='uvelka.ru'?'Увелка':undefined);
  return {productName:heading.slice(0,300),brand,packGrams,quantityText:quantity??heading,macros:parsed.data,sourceUrl:url,nutritionSourceUrl:url,quantitySourceUrl:packGrams?url:undefined,observedAt:now.toISOString(),estimated:false,evidence:block.slice(0,1200)};
}
