import type {Food, Macros, Offer} from './domain.ts';
import type {CatalogListing} from './proshoper.ts';
import {macrosSchema, validateOffer, validateSourceUrl} from './validation.ts';

export type ProductIdentityMetadata = {
  productName: string; brand?: string; barcode?: string; packGrams?: number; quantityText?: string;
};
/** Nutrients have already been verified upstream as complete, as-sold values per 100 g. */
export type ProductCandidate = ProductIdentityMetadata & {
  macros?: Macros; sourceUrl: string; nutritionSourceUrl?: string; quantitySourceUrl?: string;
  observedAt: string; estimated?: boolean; evidence?: string;
  /** Granted only by the owner's explicit product-review command, never an external provider. */
  userVerified?: boolean; reviewKind?: string;
};
export type EnrichmentRecord = {
  key: string; listingName: string; status: 'matched' | 'ambiguous' | 'not-found' | 'error';
  checkedAt: string; retryAt: string; attempts: number; reason: string; candidate?: ProductCandidate;
  provider?:'off'|'web'|'off+web'|'retailer-index'; userExcluded?: boolean;
};
type Match = {status: 'matched' | 'ambiguous' | 'not-found'; reason: string; candidate?: ProductCandidate};
type Classification = {kind: string; category: string; emoji: string; allergens: string[]};

export const REVIEW_KINDS = [
  {value:'grain',label:'Крупа и бобовые (сухие)',category:'Крупы и бобовые',emoji:'🌾'},
  {value:'pasta',label:'Макароны (сухие)',category:'Крупы и бобовые',emoji:'🍝'},
  {value:'raw-fillet',label:'Сырое филе без костей',category:'Мясо и рыба',emoji:'🍗'},
  {value:'raw-meat',label:'Сырое мясо без костей',category:'Мясо и рыба',emoji:'🥩'},
  {value:'raw-seafood',label:'Сырые очищенные морепродукты',category:'Мясо и рыба',emoji:'🦐'},
  {value:'ready-meat',label:'Готовое мясо',category:'Мясо и рыба',emoji:'🍖'},
  {value:'canned-fish',label:'Рыбные консервы',category:'Мясо и рыба',emoji:'🐟'},
  {value:'canned-beans',label:'Готовые бобовые',category:'Крупы и бобовые',emoji:'🫘'},
  {value:'curd',label:'Творог',category:'Яйца и молочное',emoji:'🥣'},
  {value:'yogurt',label:'Йогурт',category:'Яйца и молочное',emoji:'🥣'},
  {value:'cheese',label:'Сыр',category:'Яйца и молочное',emoji:'🧀'},
  {value:'bread',label:'Хлеб и лепёшки',category:'Хлеб',emoji:'🍞'},
  {value:'vegetable',label:'Овощи',category:'Овощи и фрукты',emoji:'🥕'},
  {value:'fruit',label:'Фрукты и ягоды',category:'Овощи и фрукты',emoji:'🍎'},
  {value:'nuts',label:'Орехи',category:'Орехи',emoji:'🥜'},
  {value:'dessert',label:'Десерт',category:'Десерты',emoji:'🍪'},
  {value:'ingredient',label:'Другой пищевой продукт',category:'Другие продукты',emoji:'🥣'},
] as const;

function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/,/g,'.')
    .replace(/prostokvashino/g,'простоквашино').replace(/global\s*village|глобал\s*вилладж/g,'глобалвилладж')
    .replace(/(?:barilla|барилла)/g,'барилла').replace(/(?:danone|данон)/g,'данон')
    .replace(/(?:activia|активиа|активия)/g,'активиа').replace(/(?:ehrmann|эрманн|эрман)/g,'эрман')
    .replace(/(?:epica|эпика)/g,'эпика').replace(/(?:savushkin|савушкин)/g,'савушкин')
    .replace(/(?:mistral|мистраль)/g,'мистраль').replace(/(?:uvelka|увелка)/g,'увелка')
    .replace(/(?:petelinka|петелинка)/g,'петелинка').replace(/(?:makfa|макфа)/g,'макфа');
}
function withoutQuantity(text: string): string {
  return normalize(text).replace(/\([^)]*(?:₽|руб)[^)]*\)/g,' ')
    .replace(/\d+(?:\.\d+)?\s*(?:пак(?:ет[а-я]*)?\.?\s*)?[xх×*]\s*\d+(?:\.\d+)?\s*(?:kg|кг|г|g)(?![a-zа-я])/g,' ')
    .replace(/\d+(?:\.\d+)?\s*(?:kg|кг|г|g|мл|ml|л|l|шт\.?)(?![a-zа-я])/g,' ');
}
function multipack(text:string):{count:number;size:number}|undefined{
  const value=normalize(text).replace(/\\/g,'');
  const forward=value.match(/(?:^|[^\d.])(\d+)\s*(?:пак(?:ет[а-я]*)?\.?\s*)?[xх×*]\s*(\d+(?:\.\d+)?)(?:\s*(kg|кг|г|g))?(?![\d.])/);
  const reverse=value.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(kg|кг|г|g)\s*[xх×*]\s*(\d+)(?![\d.])/);
  if(forward)return {count:Number(forward[1]),size:Number(forward[2])*(/^(kg|кг)$/.test(forward[3]??'')?1000:1)};
  if(reverse)return {count:Number(reverse[3]),size:Number(reverse[1])*(/^(kg|кг)$/.test(reverse[2])?1000:1)};
  return undefined;
}
/** Literal package mass only; no density, portion, drained-weight or edible-yield inference. */
export function parseMass(text: string): number | undefined {
  const value=normalize(text).replace(/\([^)]*(?:₽|руб)[^)]*\)/g,' ').replace(/\d+(?:\.\d+)?\s*(?:₽|руб\.?)\s*\/\s*\d*\s*кг/g,' ');
  const forward=value.match(/(?:^|[^\d.])(\d+)\s*(?:пак(?:ет[а-я]*)?\.?\s*)?[xх×*]\s*(\d+(?:\.\d+)?)\s*(kg|кг|г|g)(?![a-zа-я])/);
  const reverse=value.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(kg|кг|г|g)\s*[xх×*]\s*(\d+)(?![\d.])/);
  const single=value.match(/(?:^|[^a-zа-я\d.])(\d+(?:\.\d+)?)\s*(kg|кг|г|g)(?![a-zа-я])/);
  const grams=forward?Number(forward[1])*Number(forward[2])*(/^(kg|кг)$/.test(forward[3])?1000:1)
    :reverse?Number(reverse[1])*Number(reverse[3])*(/^(kg|кг)$/.test(reverse[2])?1000:1)
    :single?Number(single[1])*(/^(kg|кг)$/.test(single[2])?1000:1):undefined;
  return grams!==undefined && Number.isFinite(grams) && grams>0 && grams<=20000 ? grams : undefined;
}
export function enrichmentKey(row: Pick<CatalogListing,'name'|'packGrams'|'packText'>): string {
  const name=withoutQuantity(row.name).replace(/[^a-zа-я0-9%]+/g,' ').replace(/\s*%/g,'%').trim();
  const amount=row.packGrams??parseMass(row.packText??'')??parseMass(row.name);
  const quantity=amount===undefined?(normalize(row.packText??row.name).match(/\d+(?:\.\d+)?\s*(?:мл|ml|л|l|шт\.?)(?![a-zа-я])/g)??[]).join('').replace(/\s+/g,''):String(amount);
  const shape=multipack(`${row.name} ${row.packText??''}`);
  const input=`${name}|${quantity}|${shape?`${shape.count}x${shape.size}`:'single'}`;
  // Two independent 32-bit hashes keep IDs stable in browsers and workers, without Node APIs.
  let a=2166136261,b=5381;
  for(const ch of input){a=Math.imul(a^ch.charCodeAt(0),16777619);b=Math.imul(b,33)^ch.charCodeAt(0);}
  return `${(a>>>0).toString(36)}${(b>>>0).toString(36)}`;
}

/** Explicitly inedible or excluded products; an unknown culinary class is not exclusion. */
export function isExcludedProduct(name:string):boolean{
  const n=normalize(name);
  // «Лопатка для запекания» can be a meat cut. Require product context,
  // never a brand exception; explicit utensil material or use still wins.
  const shoulder=/лопатк/.test(n);
  const utensilContext=/кухонн|силикон|деревян|пластик|металл|нейлон|лопатк[а-я]*\s+для\s+(?:мяса|свинины|говядины|переворачив|жарки|сковород)/.test(n);
  const meatCutContext=/свин[а-я]*|говяж[а-я]*|баран[а-я]*|ягнен[а-я]*|охлажден[а-я]*|заморожен[а-я]*|в\s+маринаде/.test(n);
  const spatula=shoulder&&(utensilContext||/лопатк.*для/.test(n)&&!meatCutContext);
  const alcohol=!/безалкогольн/.test(n)&&(/алкогол/.test(n)||/(?:^|[^а-я])(?:пиво|вино|водка|коньяк|виски|ликер|ром)(?=[^а-я]|$)/.test(n));
  return spatula||alcohol||/шампун|мыло|гель|крем\s+для|порошок\s+(?:стираль|для)|салфет|губк|посуд|освежител|зубн|корм|кошек|собак|питомц|детск.*смесь|молочн.*смесь|смесь.*(?:детск|молочн)|infant|formula|baby\s*food|лосьон|космет|дезодорант|парфюм|маска\s+для|бальзам|молочко.*для\s+(?:тела|лица)|ложк|вилк|(?:^|[^а-я])нож(?:и|ей)?(?=[^а-я]|$)|для\s+посадки|посевн|рассад/.test(n);
}

/** A culinary class requires a recognizable food and preparation, never a nutrition estimate. */
export function classifyProduct(name: string): Classification | null {
  const n=normalize(name);
  if(isExcludedProduct(name))return null;
  // The primary product can mention a raw ingredient without being that ingredient.
  // Vegetable mixtures remain supported; cooking aids and prepared staples do not.
  if(/приправ|смесь\s+(?:сух[а-я]*\s+)?для|на\s+бумаге|на\s+второе|^суп(?:[^а-я]|$)|^пюре(?:[^а-я]|$)|^сухарик|(?:^|[^а-я])фри(?:[^а-я]|$)|с\s*\d+\s*месяц|^каша(?:[^а-я]|$)|^овсяная\s+каша/.test(n))return null;
  if(/^(?:блинчик|блины|тефтел|наггетс|риет|напиток)/.test(n))return null;
  const out=(kind:string,category:string,emoji:string,allergens:string[]=[]):Classification=>({kind,category,emoji,allergens});
  // Explicit food prefixes can be enriched without assigning raw-food or fruit portions.
  // Offline templates do not use this role; complete label data remains mandatory.
  if(/^сливки(?=[^а-я]|$)/.test(n))return out('ingredient','Яйца и молочное','🥛',['Молоко']);
  if(/^(?:чернослив|курага|изюм)(?=[^а-я]|$)/.test(n))return out('ingredient','Сухофрукты','🍇');
  if(/^(?:кунжут|семечки)(?=[^а-я]|$)|^семена\s+(?:льна|подсолнечника|тыквы|чиа|кунжута)(?=[^а-я]|$)/.test(n))return out('ingredient','Семена','🌱',/кунжут/.test(n)?['Кунжут']:[]);
  const dessert=/печень|пряник|вафл|шоколад|конфет|торт(?!иль)|пирожн|(?:^|[^а-я])мороженое(?=[^а-я]|$)|десерт|(?:^|[^а-я])(?:сырок|сырки)(?=[^а-я]|$)|творожн.*масс|творожн.*глазир/.test(n);
  if(dessert)return out('dessert','Десерты','🍪',['Молоко','Возможен глютен']);
  if(/йогурт|yogurt/.test(n))return out('yogurt','Яйца и молочное','🥣',['Молоко']);
  if(/творог|творожн/.test(n))return out('curd','Яйца и молочное','🥣',['Молоко']);
  if(/(?:^|[^а-я])сыр(?:[^а-я]|$)|моцарелл|пармезан|сулугуни|брынз/.test(n))return out('cheese','Яйца и молочное','🧀',['Молоко']);
  if(/хлеб|батон|лаваш|булоч|лепешк|тортиль/.test(n))return out('bread','Хлеб','🍞',['Пшеница (глютен)']);
  if(/тунец|горбуш|сардин|сайр|скумбри|шпрот|минтай|лосос|сельд|кильк/.test(n)&&(/консерв|собственн.*сок|в масле|в томат/.test(n)||(/натуральн/.test(n)&&/ж\s*\/\s*б|жестян.*банк/.test(n))))return out('canned-fish','Мясо и рыба','🐟',['Рыба']);
  if(/фасол|нут(?:\s|$)|горошек/.test(n)&&/консерв|в соус|в томат|в собственном/.test(n))return out('canned-beans','Крупы и бобовые','🫘');
  if(/колбас|сосиск|сардельк|ветчин|буженин|паштет|тушенк|мяс.*консерв/.test(n)||(/говядин|свинин/.test(n)&&/тушен/.test(n)))return out('ready-meat','Мясо и рыба','🍖');
  const cooked=/жарен|варен|запечен|копчен|вялен|солен|паниров|кляр|готов|гриль|маринован/.test(n);
  if(/филе|фарш|гуляш|мякоть|кревет|кальмар/.test(n)){
    if(/кревет|кальмар/.test(n)&&/неочищ|панцир|раковин/.test(n))return null;
    if(cooked)return /кур|цыпл|индей|говяж|свин|мяс/.test(n)?out('ready-meat','Мясо и рыба','🍗'):null;
    if(/кревет.*очищ|очищ.*кревет|кальмар.*(?:очищ|филе)|(?:очищ|филе).*кальмар/.test(n))return out('raw-seafood','Мясо и рыба','🦐',['Морепродукты']);
    if(/филе/.test(n)&&/кур|цыпл|индей|минта|тунц|треск|хек|лосос|форел|пангасиус|тилап/.test(n))return out('raw-fillet','Мясо и рыба','🍗',/минта|тунц|треск|хек|лосос|форел|пангасиус|тилап/.test(n)?['Рыба']:[]);
    if(/(?:фарш|гуляш|мякоть)/.test(n)&&/кур|цыпл|индей|говяж|свин|мяс/.test(n)&&!/кост|костей/.test(n))return out('raw-meat','Мясо и рыба','🥩');
    return null;
  }
  if(/макарон|спагетти|вермишел|рожки|пенне|фузилли/.test(n))return out('pasta','Крупы и бобовые','🍝',['Пшеница (глютен)']);
  if(/греч|(?:^|[^а-я])рис(?:[^а-я]|$)|крупа|овсян|геркулес|хлопья|булгур|перлов|пшено|чечевиц|кус-?кус/.test(n)&&!/напиток|молоко|хлеб|печень|суп/.test(n))return out('grain','Крупы и бобовые','🌾',/овсян|геркулес|пшен|булгур|перлов|кус-?кус/.test(n)?['Возможен глютен']:[]);
  if(/миндаль|фундук|грецк.*орех|кешью|арахис|фисташк|орех.*смесь/.test(n))return out('nuts','Орехи','🥜',['Орехи']);
  if(!/сок|пюре|повидло|джем|варенье|напиток|соус|консерв|сушен|чипс|маринован|солен|жарен|варен|запечен|по корейски/.test(n)){
    if(/^(?:морковь|картофель|огурц|огурцы|томаты|помидор|лук|капуста|свекла|кабач|баклаж|перец|брокколи|цветная капуста|тыква|смесь овощ|овощн.*смесь)/.test(n))return out('vegetable','Овощи и фрукты','🥕');
    if(/^(?:яблок|груш|банан|апельсин|мандарин|лимон|киви|виноград|персик|нектарин|слив(?:а|ы)(?=[^а-я]|$)|ананас|манго|хурма|гранат|авокадо|клубника|малина|черника)/.test(n))return out('fruit','Овощи и фрукты','🍎');
  }
  return null;
}

function tokens(text:string):string[]{
  const grain=/гречнев|гречка/.test(normalize(text));
  let value=withoutQuantity(text).replace(/в\s+пакетиках\s+для\s+варки/g,' ').replace(/\d+\s*[\\]*[xх×*]\s*\d+(?:\.\d+)?/g,' ');
  if(/^кунжут(?=[^а-я]|$)/.test(normalize(text)))value=value.replace(/(?:^|\s)семена(?=[^а-я]|$)/g,' ');
  if(classifyProduct(text)?.kind==='canned-fish')value=value.replace(/в\s+собственном\s+соку/g,'натуральный').replace(/ж\s*\/\s*б(?:\s+ключ)?/g,' ').replace(/жестян[а-я]*\s+банк[а-я]*/g,' ');
  return [...new Set(value.replace(/\d+(?:\.\d+)?\s*%/g,' ').replace(/[^a-zа-я0-9]+/g,' ').split(' ')
    .filter(t=>t.length>1&&!['из','на','со','для','без','упаковка','упаковке','пачка','пакет','грамм','граммов'].includes(t))
    .filter(t=>!grain||!['крупа','ядрица','быстроразваривающаяся'].includes(t))
    .map(t=>t.replace(/(?:куриное|куриный|куриная)/,'курин').replace(/(?:гречневая|гречневую|гречка)/,'гречнев').replace(/(?:натуральный|натуральная|натуральное)/,'натуральн')
      .replace(/^(?:рожки|рожок)$/,'рожок').replace(/^(?:овсяные|овсяный|овсяная)$/,'овсян')
      .replace(/^(?:салат|салата|салатов|салатный)$/,'салат').replace(/^(?:высшего|высший|высшая|высшее)$/,'высш').replace(/^(?:сорт|сорта)$/,'сорт')
      .replace(/(?:охлажденное|охлажденный|охлажденная)/,'охлажден').replace(/(?:замороженное|замороженный|замороженная)/,'заморожен')))];
}
function fat(text:string):number[]{return [...normalize(text).matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map(m=>Number(m[1])).sort((a,b)=>a-b);}
function complete(candidate:ProductCandidate):boolean{
  try{
    if(!candidate.productName?.trim()||!macrosSchema.safeParse(candidate.macros).success||!Number.isFinite(Date.parse(candidate.observedAt)))return false;
    validateSourceUrl(candidate.sourceUrl);
    if(candidate.nutritionSourceUrl)validateSourceUrl(candidate.nutritionSourceUrl);
    if(candidate.quantitySourceUrl)validateSourceUrl(candidate.quantitySourceUrl);
    return true;
  }catch{return false;}
}
function candidateMass(c:ProductIdentityMetadata):number|undefined{return c.packGrams??parseMass(c.quantityText??'')??parseMass(c.productName);}
function localMass(r:CatalogListing):number|undefined{return r.packGrams??parseMass(r.packText??'')??parseMass(r.name);}
function nonMassQuantities(text:string):string[]{
  return [...new Set([...normalize(text).matchAll(/(?:^|[^a-zа-я\d.])(\d+(?:\.\d+)?)\s*(мл|ml|л|l|шт\.?)(?![a-zа-я])/g)].map(m=>{
    const unit=m[2],volume=!unit.startsWith('шт');
    return `${volume?'ml':'count'}:${Number(m[1])*(/^(л|l)$/.test(unit)?1000:1)}`;
  }))].sort();
}
function fallbackLabel(candidate:ProductCandidate):boolean{
  return /(?:на\s*100\s*г(?:рамм)?|per\s*100\s*g|\b100\s*g\b|\bas_sold\b)/i.test(candidate.evidence??'');
}
function matchedClassification(row:CatalogListing,c:ProductCandidate):Classification|null{
  if(isExcludedProduct(row.name)||isExcludedProduct(c.productName))return null;
  if(c.userVerified){
    const role=REVIEW_KINDS.find(k=>k.value===c.reviewKind);
    return role?{kind:role.value,category:role.category,emoji:role.emoji,allergens:classifyProduct(row.name)?.allergens??['Уточните по этикетке']}:null;
  }
  const local=classifyProduct(row.name),external=classifyProduct(c.productName);
  if(local&&external)return local.kind===external.kind?external:null;
  return fallbackLabel(c)?{kind:'ingredient',category:'Другие продукты',emoji:'🥣',allergens:['Уточните по этикетке']}:null;
}
function edibleYieldRisk(name:string):boolean{
  const n=normalize(name);
  if(/тушк|цел[а-я]*\s+(?:кур|цыпл|рыб)|на\s+кост|с\s+кост|неразделан|неочищ|панцир|раковин|скорлуп/.test(n))return true;
  if(/(?:^|[^а-я])(?:курица|цыпленок|утка|гусь|индейка)(?=[^а-я]|$)/.test(n)&&!/филе|фарш|мякоть|без\s+кост/.test(n))return true;
  // Whole raw fish and shellfish require an edible-yield measurement. Canned products
  // have their own classification and never take this fallback branch.
  if(/минтай|горбуш|тунец|треск|скумбри|лосос|форел|сельд|сайра|дорадо|сибас|карп|сазан|щука|кревет|миди|устриц/.test(n)&&!/филе|очищ|без\s+кост/.test(n))return true;
  return false;
}
/** Narrows external indexes only. A match supplies no nutrition or provenance proof. */
export function productIdentityMatches(row:CatalogListing,c:ProductIdentityMetadata):boolean{
  if(!c.productName?.trim()||isExcludedProduct(row.name)||isExcludedProduct(c.productName))return false;
  if(row.barcode&&row.barcode!==c.barcode)return false;
  const rowClass=classifyProduct(row.name),candidateClass=classifyProduct(c.productName);
  if(rowClass&&candidateClass&&rowClass.kind!==candidateClass.kind)return false;
  // Unknown edible categories still require exact, sufficiently specific identity.
  // Their explicit per-100-g label evidence is checked only after retrieval.
  const classification=rowClass&&candidateClass?candidateClass:{kind:'ingredient'};
  const fallback=!rowClass||!candidateClass;
  const rowFat=fat(row.name),candidateFat=fat(c.productName);
  if(rowFat.length!==candidateFat.length||rowFat.some((n,i)=>n!==candidateFat[i]))return false;
  const mass=localMass(row),other=candidateMass(c);
  // A spoonable yogurt's texture adjective may be omitted locally only when the
  // branded product, explicit fat percentage and explicit package mass all agree.
  const optionalThickness=classification.kind==='yogurt'&&!!c.brand?.trim()&&rowFat.length>0&&mass!==undefined&&other!==undefined&&Math.abs(mass-other)<0.01&&!/питьев/.test(normalize(`${row.name} ${c.productName}`));
  const nameTokens=(name:string)=>tokens(name).filter(t=>!optionalThickness||t!=='густой');
  const rowName=nameTokens(row.name),brand=tokens(c.brand??''),explicitBrand=tokens(row.brand??'');
  if(explicitBrand.length&&!explicitBrand.every(t=>brand.includes(t)||tokens(c.productName).includes(t)))return false;
  if(brand.length&&!brand.every(t=>rowName.includes(t)||explicitBrand.includes(t)))return false;
  const candidateName=nameTokens(`${c.productName} ${c.brand??''}`),rowAll=[...new Set([...rowName,...explicitBrand])];
  if(fallback&&rowAll.length<3&&!(brand.length>0&&rowAll.length>=2&&rowFat.length>0))return false;
  // Extra flavors, cuts and preparation words are identity changes, even if most words match.
  if(!rowAll.every(t=>candidateName.includes(t))||!candidateName.every(t=>rowAll.includes(t)))return false;
  const localPack=multipack(`${row.name} ${row.packText??''}`),externalPack=multipack(`${c.productName} ${c.quantityText??''}`);
  if(!!localPack!==!!externalPack)return false;
  if(localPack&&externalPack&&(localPack.count!==externalPack.count||Math.abs(localPack.size-externalPack.size)>0.01))return false;
  if(mass!==undefined&&other!==undefined&&Math.abs(mass-other)>0.01)return false;
  if(c.packGrams!==undefined&&(!Number.isFinite(c.packGrams)||c.packGrams<=0||c.packGrams>20000))return false;
  const quantityMass=parseMass(c.quantityText??'');
  if(c.packGrams!==undefined&&quantityMass!==undefined&&Math.abs(c.packGrams-quantityMass)>0.01)return false;
  const localUnits=nonMassQuantities(`${row.name} ${row.packText??''}`),externalUnits=nonMassQuantities(`${c.productName} ${c.quantityText??''}`);
  if((localUnits.length&&other!==undefined)||(externalUnits.length&&mass!==undefined))return false;
  if(localUnits.length!==externalUnits.length||localUnits.some((unit,i)=>unit!==externalUnits[i]))return false;
  const fresh=['vegetable','fruit'].includes(classification.kind);
  if(rowAll.length<2&&!fresh)return false;
  // An unidentified package cannot be paired to a local one from generic category alone.
  if(other===undefined&&!fresh&&!(brand.length>0&&(rowAll.length>=3||(rowAll.length>=2&&rowFat.length>0))))return false;
  return true;
}
function identity(row:CatalogListing,c:ProductCandidate):boolean{
  if(c.userVerified){
    const mass=localMass(row);
    return complete(c)&&c.productName===row.name&&!isExcludedProduct(row.name)&&!!matchedClassification(row,c)
      &&typeof c.packGrams==='number'&&Number.isFinite(c.packGrams)&&c.packGrams>0&&c.packGrams<=20000
      &&(mass===undefined||Math.abs(mass-c.packGrams)<0.01);
  }
  return complete(c)&&!!matchedClassification(row,c)&&productIdentityMatches(row,c);
}
export function matchProduct(row:CatalogListing,candidates:ProductCandidate[]):Match{
  const matches=candidates.filter(c=>identity(row,c));
  const distinct=new Map<string,ProductCandidate>();
  for(const c of matches){const key=JSON.stringify([c.barcode??c.sourceUrl,candidateMass(c),c.macros]);if(!distinct.has(key))distinct.set(key,c);}
  if(distinct.size===0)return {status:'not-found',reason:'Нет полного безопасного совпадения названия, бренда, жирности и фасовки.'};
  if(distinct.size>1)return {status:'ambiguous',reason:'Несколько подходящих товаров или фасовок; автоматический выбор небезопасен.'};
  return {status:'matched',reason:'Совпали название, бренд, жирность и известная фасовка; КБЖУ полные на 100 г.',candidate:[...distinct.values()][0]};
}
export function enrichedFood(row:CatalogListing,candidate:ProductCandidate):Food|null{
  if(!identity(row,candidate))return null;
  const classification=matchedClassification(row,candidate);if(!classification)return null;
  return {id:`e-${enrichmentKey(row)}`,name:candidate.productName,...classification,macros:{...candidate.macros!}};
}
export function enrichedOffer(row:CatalogListing,record:EnrichmentRecord,now=new Date()):Offer|null{
  if(record.userExcluded||record.status!=='matched'||record.key!==enrichmentKey(row)||!record.candidate)return null;
  const candidate=record.candidate,food=enrichedFood(row,candidate);
  if(!food||!['listed','in-stock'].includes(row.availability)||!row.localEvidence?.trim()||!row.price||!Number.isFinite(row.price)||!Number.isFinite(Date.parse(row.observedAt)))return null;
  const classification=matchedClassification(row,candidate)!;
  if(!candidate.userVerified&&classification.kind==='ingredient'&&(!classifyProduct(row.name)||!classifyProduct(candidate.productName))&&edibleYieldRisk(`${row.name} ${candidate.productName}`))return null;
  const kilogram=row.priceUnit==='kg'&&['vegetable','fruit'].includes(classification.kind);
  if(row.priceUnit!=='pack'&&!kilogram)return null;
  const fromRow=localMass(row),grams=kilogram?1000:fromRow??candidateMass(candidate);
  if(grams===undefined)return null;
  // An explicit local volume or count requires matching units, never a cross-unit substitution.
  if(!candidate.userVerified&&!kilogram&&fromRow===undefined&&/(?:\d\s*(?:мл|ml|л|l|шт)(?![a-zа-я]))/i.test(row.packText??row.name))return null;
  const quantitySourceUrl=kilogram||fromRow!==undefined?row.sourceUrl:candidate.quantitySourceUrl??candidate.sourceUrl;
  const expiry=row.validUntil??new Date(Date.parse(row.observedAt)+86400000).toISOString();
  try{return validateOffer({id:`enriched-${row.id}`.slice(0,120),foodId:food.id,name:row.name,storeId:row.storeId,price:row.price,packGrams:grams,macros:food.macros,observedAt:row.observedAt,validFrom:row.validFrom,validUntil:expiry,expiryKind:row.validUntil?'promotion':'freshness',sourceUrl:row.sourceUrl,evidence:[row.evidence,candidate.evidence].filter(Boolean).join('\n').slice(0,2000),localEvidence:row.localEvidence,verification:'catalog',locality:'city-catalog',localConfirmed:true,status:'confirmed',nutritionEstimated:candidate.estimated!==false,demo:false,minPacks:1,priceCondition:'Цена городского каталога. Условия покупки и остатки конкретной точки не подтверждены.',quantityNote:candidate.userVerified?`Масса съедобного продукта ${grams} г указана пользователем вручную; источник: ${quantitySourceUrl}. Плотность и съедобный выход автоматически не рассчитывались.`:kilogram?'Цена за 1 кг; в покупку включено 1000 г. Фактическую массу взвешивают при покупке.':`Масса упаковки ${grams} г; источник: ${quantitySourceUrl}. Съедобный выход не пересчитывался.`,barcode:candidate.barcode,brand:candidate.brand,nutritionSourceUrl:candidate.nutritionSourceUrl??candidate.sourceUrl,quantitySourceUrl,nutritionProductName:candidate.productName,nutritionObservedAt:candidate.observedAt},[food.id],now);}catch{return null;}
}
