import test from 'node:test';
import assert from 'node:assert/strict';
import type {CatalogListing} from '../lib/proshoper.ts';
import {allFoods,menuRecipes} from '../lib/menu-recipes.ts';
import {DEFAULT_INPUT} from '../lib/domain.ts';
import {optimizeMenu} from '../lib/optimizer.ts';
import * as api from '../lib/product-enrichment.ts';
const now = new Date('2026-10-19T12:00:00Z');
const row = (changes: Partial<CatalogListing> = {}): CatalogListing => ({id:'catalog:1',name:'Творог Простоквашино 5% 200 г',storeId:'magnit',sourceId:'magnit-local',sourceUrl:'https://proshoper.ru/kogalym/actions/magnit-magazin/#id_product_1',price:89.99,packGrams:200,packText:'200 г',priceUnit:'pack',availability:'listed',observedAt:now.toISOString(),lastSeenAt:now.toISOString(),localEvidence:'Городской каталог Когалыма',evidence:'Цена карточки 89.99 руб.',...changes});
const candidate = (changes: Record<string, unknown> = {}) => ({productName:'Творог Простоквашино 5%',brand:'Простоквашино',barcode:'3017620422003',packGrams:200,quantityText:'200 g',macros:{kcal:121,protein:17,fat:5,carbs:1.8},sourceUrl:'https://world.openfoodfacts.org/product/3017620422003',observedAt:now.toISOString(),estimated:false,...changes});
function available() { assert.ok(api); }

test('normalizes listing identities across formatting but keeps different masses and names distinct', () => {
  available();
  const key = api.enrichmentKey(row());
  assert.equal(key,api.enrichmentKey(row({name:'ТВОРОГ «Простоквашино» 5 % 200г',packText:'200g'})));
  assert.notEqual(key,api.enrichmentKey(row({packGrams:300})));
  assert.ok(key.length<=36);
});
test('parses literal mass and multipacks without converting volume or pieces to grams', () => {
  available();
  for (const [text, expected] of [['400 g',400],['1,2 кг',1200],['5пак*80г',400],['4 x 125 g',500],['200 г х 4',800],['1 л',undefined],['6 шт',undefined],['950г (199₽/1кг)',950],['0 г',undefined]] as const) assert.equal(api.parseMass(text),expected,text);
});
test('matches exact branded identity including Latin brand aliases', () => {
  available();
  const result=api.matchProduct(row(),[candidate({productName:'Творог Prostokvashino 5%',brand:'Prostokvashino'})]);
  assert.equal(result.status,'matched');
  assert.equal(result.candidate?.packGrams,200);
});
test('rejects conflicting fat, packs, brands, flavors and preparation', () => {
  available();
  for (const changes of [{productName:'Творог Простоквашино 9%'},{packGrams:300,quantityText:'300г'},{brand:'Савушкин'},{productName:'Творог Простоквашино 5% с клубникой'},{productName:'Творог Простоквашино 5% обезжиренный'}]) assert.notEqual(api.matchProduct(row(),[candidate(changes)]).status,'matched',JSON.stringify(changes));
  assert.notEqual(api.matchProduct(row({name:'Филе куриное Петелинка 500г',packGrams:500}),[candidate({productName:'Филе куриное Петелинка запеченное',brand:'Петелинка',packGrams:500,quantityText:'500г'})]).status,'matched');
});
test('missing mass never chooses one of multiple otherwise identical packs', () => {
  available();
  const result=api.matchProduct(row({name:'Творог Простоквашино 5%',packGrams:undefined,packText:undefined}),[candidate(),candidate({barcode:'3017620422004',packGrams:300,quantityText:'300г'})]);
  assert.equal(result.status,'ambiguous');
  assert.equal(result.candidate,undefined);
});
test('known local pack can pair with quantity-free highly specific branded identity', () => {
  available();
  assert.equal(api.matchProduct(row(),[candidate({packGrams:undefined,quantityText:undefined})]).status,'matched');
  assert.notEqual(api.matchProduct(row({name:'Йогурт',packGrams:150}),[candidate({productName:'Йогурт',brand:undefined,packGrams:150,quantityText:'150г'})]).status,'matched');
});
test('real search distractors cannot enrich unrelated local rice, buckwheat or cottage cheese', () => {
  available();
  const distractors=[candidate({productName:'Хлопья 5 злаков увелка',brand:'Увелка',quantityText:'350g',packGrams:350}),candidate({productName:'Овсяная каша с бананом и клубникой',brand:'Увелка'}),candidate({productName:'Global village смесь мексиканская',brand:'Global Village',quantityText:'400г',packGrams:400}),candidate({productName:'Творог',brand:'Родная деревня'})];
  for(const name of ['Крупа гречневая Увелка 800г','Рис Global Village 900г','Творог Першинское обезжиренный 380г']) assert.equal(api.matchProduct(row({name,packGrams:api.parseMass(name)}),distractors).status,'not-found');
});
test('does not turn missing or invalid nutrition into zero and does not trust bad provenance', () => {
  available();
  for(const changes of [{macros:undefined},{macros:{kcal:121,protein:17,fat:null,carbs:1.8}},{macros:{kcal:121,protein:101,fat:0,carbs:0}},{sourceUrl:'http://localhost/private'}]) assert.equal(api.matchProduct(row(),[candidate(changes)]).status,'not-found');
});
test('classifies supported foods conservatively and refuses nonfood, pet food and unsafe raw cuts', () => {
  available();
  for(const [name,kind] of [['Рис Мистраль', 'grain'],['Спагетти Barilla','pasta'],['Йогурт греческий','yogurt'],['Сыр гауда','cheese'],['Хлеб ржаной','bread'],['Тунец в собственном соку консервы','canned-fish'],['Фасоль консервированная','canned-beans'],['Колбаса вареная','ready-meat'],['Филе минтая замороженное','raw-fillet'],['Фарш говяжий охлажденный','raw-meat'],['Креветки очищенные замороженные','raw-seafood'],['Морковь мытая','vegetable'],['Яблоки Гала','fruit'],['Миндаль жареный','nuts'],['Печенье овсяное','dessert']] as const) assert.equal(api.classifyProduct(name)?.kind,kind,name);
  for(const name of ['Шампунь с йогуртом','Корм для кошек с курицей','Детская молочная смесь','Пиво рисовое','Минтай тушка','Курица целая','Что-то неизвестное']) assert.equal(api.classifyProduct(name),null,name);
});
test('builds distinct food and validated local-price offer with exact external provenance', () => {
  available();
  const c=candidate({nutritionSourceUrl:'https://brand.example/nutrition',quantitySourceUrl:'https://brand.example/package'});
  const record={key:api.enrichmentKey(row()),listingName:row().name,status:'matched' as const,checkedAt:now.toISOString(),retryAt:now.toISOString(),attempts:1,reason:'Совпадение',candidate:c};
  const food=api.enrichedFood(row(),c)!;const offer=api.enrichedOffer(row(),record,now)!;
  assert.ok(food.id.startsWith('e-'));assert.equal(food.id,offer.foodId);assert.equal(food.name,c.productName);assert.equal(offer.price,89.99);assert.equal(offer.packGrams,200);assert.equal(offer.nutritionSourceUrl,'https://brand.example/nutrition');assert.equal(offer.quantitySourceUrl,row().sourceUrl);assert.equal(offer.nutritionEstimated,false);assert.equal(offer.nutritionProductName,c.productName);assert.equal(offer.validUntil,'2026-10-20T12:00:00.000Z');
});
test('offer requires matching cache key, quantity, local evidence, current available price and food classification', () => {
  available();
  const record={key:api.enrichmentKey(row()),listingName:row().name,status:'matched' as const,checkedAt:now.toISOString(),retryAt:now.toISOString(),attempts:1,reason:'Совпадение',candidate:candidate()};
  assert.equal(api.enrichedOffer(row(),{...record,key:'different'},now),null);
  for(const changes of [{availability:'out-of-stock' as const},{price:undefined},{priceUnit:'unknown' as const},{localEvidence:''},{validFrom:'2026-10-20T00:00:00Z'},{validUntil:'2026-10-19T01:00:00Z'},{observedAt:'2026-10-17T00:00:00Z'}]) assert.equal(api.enrichedOffer(row(changes),record,now),null,JSON.stringify(changes));
  const noMass=row({name:'Йогурт Простоквашино натуральный 2%',packGrams:undefined,packText:'150 мл'});const c=candidate({productName:noMass.name,quantityText:'150 ml',packGrams:undefined});
  assert.equal(api.enrichedOffer(noMass,{...record,key:api.enrichmentKey(noMass),candidate:c},now),null);
});
test('fresh kilogram prices buy exactly 1000 literal grams and state this quantity', () => {
  available();const r=row({name:'Яблоки Гала 1кг',packGrams:undefined,packText:'1кг',priceUnit:'kg',price:99.99});const c=candidate({productName:'Яблоки Гала',brand:undefined,barcode:undefined,packGrams:undefined,quantityText:undefined,macros:{kcal:47,protein:0.4,fat:0.4,carbs:9.8}});
  const record={key:api.enrichmentKey(r),listingName:r.name,status:'matched' as const,checkedAt:now.toISOString(),retryAt:now.toISOString(),attempts:1,reason:'Совпадение',candidate:c};
  const offer=api.enrichedOffer(r,record,now);assert.ok(offer);assert.equal(offer.packGrams,1000);assert.equal(offer.price,99.99);assert.match(offer.quantityNote!,/1000/);
});
test('multipack identity keeps 5x80 distinct from a single 400 gram package',()=>{
  const r=row({name:'Крупа Увелка гречневая 5пак*80г',packGrams:400,packText:'5пак*80г'});
  const c=candidate({productName:'Крупа гречневая Увелка 400г',brand:'Увелка',packGrams:400,quantityText:'400г'});
  assert.equal(api.matchProduct(r,[c]).status,'not-found');
  assert.equal(api.matchProduct(r,[{...c,productName:'Крупа гречневая Увелка 5x80г',quantityText:'5x80г'}]).status,'matched');
});
test('known barcode mismatch and generic quantity-free branded families remain unmatched',()=>{
  assert.equal(api.matchProduct(row({barcode:'4607016245348'}),[candidate()]).status,'not-found');
  assert.equal(api.matchProduct(row({name:'Йогурт Простоквашино',packGrams:150}),[candidate({productName:'Йогурт Простоквашино',packGrams:undefined,quantityText:undefined})]).status,'not-found');
});
test('primary real product titles match controlled grain and Russian grammatical synonyms',()=>{
  const cases=[
    {name:'Крупа Увелка гречневая 500г',title:'Крупа гречневая ядрица 500 г',brand:'Увелка',grams:500,quantity:'500 г'},
    {name:'Гречка Увелка Экстра 800г',title:'Гречка Экстра',brand:'Увелка',grams:800,quantity:'800 г'},
    {name:'Крупа Увелка Гречневая ядрица Экстра 5пак*80г',title:'КРУПА ГРЕЧНЕВАЯ ЯДРИЦА БЫСТРОРАЗВАРИВАЮЩАЯСЯ «ЭКСТРА» В ПАКЕТИКАХ ДЛЯ ВАРКИ',brand:'Увелка',grams:400,quantity:'5*80г'},
    {name:'Макароны Шебекинские №202 Рожок полубублик 450г',title:'Макароны Шебекинские №202 Рожок полубублик 450г',brand:'Шебекинские',grams:450,quantity:'450 г'},
    {name:'Хлопья Царь овсяные Геркулес 400г',title:'Хлопья Царь овсяные Геркулес 400г',brand:'Царь',grams:400,quantity:'400 г'},
  ];
  for(const item of cases){const c=candidate({productName:item.title,brand:item.brand,packGrams:item.grams,quantityText:item.quantity});assert.equal(api.matchProduct(row({name:item.name,packGrams:item.grams,packText:item.quantity}),[c]).status,'matched',item.name);}
  const r=row({name:'Макароны Шебекинские Рожки 450г',packGrams:450});
  assert.equal(api.matchProduct(r,[candidate({productName:'Макароны Шебекинские Рожок 450г',brand:'Шебекинские',packGrams:450,quantityText:'450г'})]).status,'matched');
  assert.equal(api.matchProduct(r,[candidate({productName:'Макароны Шебекинские Спагетти 450г',brand:'Шебекинские',packGrams:450,quantityText:'450г'})]).status,'not-found');
});
test('malformed observation timestamps produce no offer rather than throwing',()=>{
  const r=row({observedAt:'not-a-date'});const record={key:api.enrichmentKey(r),listingName:r.name,status:'matched' as const,checkedAt:now.toISOString(),retryAt:now.toISOString(),attempts:1,reason:'Совпадение',candidate:candidate()};
  assert.equal(api.enrichedOffer(r,record,now),null);
});
test('fingerprints retain multipack structure and volume/count labels without gram inference',()=>{
  assert.notEqual(api.enrichmentKey(row({name:'Рис Увелка 5x80г',packGrams:400,packText:'5x80г'})),api.enrichmentKey(row({name:'Рис Увелка 400г',packGrams:400,packText:'400г'})));
  assert.notEqual(api.enrichmentKey(row({name:'Йогурт Чудо 150мл',packGrams:undefined,packText:undefined})),api.enrichmentKey(row({name:'Йогурт Чудо 300мл',packGrams:undefined,packText:undefined})));
});
test('tortillas and couscous use the correct culinary class while dried fruit is a separate ingredient',()=>{
  assert.equal(api.classifyProduct('Тортилья Mutlukal 260г')?.kind,'bread');
  assert.equal(api.classifyProduct('Кускус Premiere 450г')?.kind,'grain');
  assert.equal(api.classifyProduct('Кус-кус Premiere 450г')?.kind,'grain');
  assert.equal(api.classifyProduct('Чернослив Восточный Гость 150г')?.kind,'ingredient');
});
test('cream and dried plums never become fresh fruit',()=>{
  for(const name of ['Сливки Село Зелёное20%,500г','Сливки Село Зелёное стерилизованные 20% БЗМЖ 500г','Чернослив Восточный Гость 150г'])assert.equal(api.classifyProduct(name)?.kind,'ingredient',name);
  assert.equal(api.classifyProduct('Слива красная 1кг')?.kind,'fruit');
  assert.equal(api.classifyProduct('Сливы красные 1кг')?.kind,'fruit');
});
test('explicit natural canned fish and stewed beef or pork have cooked culinary classes',()=>{
  assert.equal(api.classifyProduct('Тунец Рыбарь170г натуральный для салатов ж/б ключ')?.kind,'canned-fish');
  assert.equal(api.classifyProduct('Говядина тушеная Орский МК ГОСТ, 338г')?.kind,'ready-meat');
  assert.equal(api.classifyProduct('Свинина тушеная 338г')?.kind,'ready-meat');
  assert.equal(api.classifyProduct('Свинина охлажденная'),null);
});
const actibio=()=>candidate({productName:'Густой натуральный биойогурт АктиБио, 3,5%, 130 г',brand:'АктиБио',barcode:undefined,packGrams:130,quantityText:'130 г',macros:{kcal:79,protein:4.8,fat:3.5,carbs:7},sourceUrl:'https://actibio-club.ru/gustoj_biojogurt/klassicheskij-bioyogurt-naturalnyj'});
test('specific branded yogurt accepts descriptive thickness only with matching explicit fat and pack',()=>{
  const r=row({name:'Биойогурт Актибио натуральный 3.5% 130г',packGrams:130,packText:'130г'});
  assert.equal(api.matchProduct(r,[actibio()]).status,'matched');
  for(const change of [{name:'Биойогурт Актибио питьевой натуральный 3.5% 130г'},{name:'Биойогурт Актибио натуральный с ванилью 3.5% 130г'},{name:'Биойогурт Актибио натуральный 2% 130г'},{packGrams:260},{name:'Биойогурт Актибио натуральный 3.5%',packGrams:undefined,packText:undefined}])assert.equal(api.matchProduct(row({...r,...change}),[actibio()]).status,'not-found',JSON.stringify(change));
});
test('live natural tuna wording canonicalizes packaging and salad grammar without accepting oil variants',()=>{
  const r=row({name:'Тунец Рыбарь в собственном соку для салата, 170г',packGrams:170,packText:'170г'});
  const c=candidate({productName:'Тунец Рыбарь170г натуральный для салатов ж/б ключ',brand:'Рыбарь',barcode:undefined,packGrams:170,quantityText:'170г',macros:{kcal:85,protein:20,fat:0.2,carbs:0}});
  assert.equal(api.matchProduct(r,[c]).status,'matched');
  assert.equal(api.matchProduct(r,[{...c,productName:'Тунец Рыбарь170г натуральный для салатов в масле ж/б ключ'}]).status,'not-found');
  assert.equal(api.matchProduct(r,[{...c,productName:'Тунец Рыбарь натуральный стейк ж/б ключ 170г'}]).status,'not-found');
});
test('stewed meat grade requires explicit primary-product identity rather than ignoring missing grade',()=>{
  const r=row({name:'Говядина Орский МК тушеная высшего сорта гост 338г',packGrams:338,packText:'338г'});
  const c=candidate({productName:'Говядина тушеная Орский МК ГОСТ, 338г',brand:'Орский МК',barcode:undefined,packGrams:338,quantityText:'338г',macros:{kcal:213,protein:15,fat:17,carbs:0},evidence:'«СортВысший»; «ГОСТ32125-2013»'});
  assert.equal(api.matchProduct(r,[c]).status,'not-found');
  assert.equal(api.matchProduct(r,[{...c,productName:c.productName+'. Сорт: Высший'}]).status,'matched');
  assert.equal(api.matchProduct(r,[{...c,productName:c.productName+'. Сорт: Первый'}]).status,'not-found');
});
test('real enriched yogurt survives registry and contributes to an available recipe without invented nutrition',()=>{
  const proofNow=new Date('2026-10-19T13:45:00Z');
  const r=row({name:'Биойогурт Актибио натуральный 3.5% 130г',packGrams:130,packText:'130г',price:34.99,sourceUrl:'https://proshoper.ru/kogalym/actions/magnit-magazin/#id_product_51893276',observedAt:'2026-10-19T13:05:15.786Z',validUntil:'2026-10-20T23:59:59.999+05:00'});
  const match=api.matchProduct(r,[actibio()]);assert.equal(match.status,'matched');
  const record={key:api.enrichmentKey(r),listingName:r.name,status:'matched' as const,checkedAt:now.toISOString(),retryAt:'2026-10-26T12:00:00Z',attempts:1,reason:match.reason,candidate:match.candidate};
  const oats=row({id:'catalog:oats',name:'Хлопья Царь овсяные Геркулес 400г',packGrams:400,packText:'400г',price:49.99,sourceUrl:'https://proshoper.ru/kogalym/actions/magnit-magazin/#id_product_51894175',observedAt:r.observedAt,validUntil:r.validUntil});
  const oatsCandidate=candidate({productName:oats.name,brand:'Царь',barcode:undefined,packGrams:400,quantityText:'400г',macros:{kcal:350,protein:12,fat:6,carbs:62},sourceUrl:'https://magnit.ru/product/1000146531-tsar_khlopya_ovsyanye_gerkules_400g_briket_soyuzpishcheprom_20'});
  const oatsRecord={...record,key:api.enrichmentKey(oats),listingName:oats.name,candidate:oatsCandidate};
  const food=api.enrichedFood(r,match.candidate!)!;const offer=api.enrichedOffer(r,record,proofNow)!;const oatsOffer=api.enrichedOffer(oats,oatsRecord,proofNow)!;assert.ok(offer);assert.ok(oatsOffer);
  const foods=allFoods([record,oatsRecord],[r,oats]);const input={...DEFAULT_INPUT,budget:300,proteinMin:20,meals:1,storeIds:['magnit']};const offers=[offer,oatsOffer];const recipes=menuRecipes(foods,offers,input,proofNow);
  assert.deepEqual(food.macros,{kcal:79,protein:4.8,fat:3.5,carbs:7});assert.equal(offer.packGrams,130);assert.equal(offer.price,34.99);
  assert.ok(recipes.some(recipe=>recipe.ingredients.some(ingredient=>ingredient.foodId===food.id)));
  const result=optimizeMenu(input,offers,recipes,proofNow);assert.equal(result.feasible,true);assert.ok(result.shopping.some(item=>item.offer.foodId===food.id));
});
test('secondary ingredient words in seasonings, soup, crumbs and infant puree never define the food class',()=>{
  for(const name of ['Картофельное пюре Роллтон с сухариками 40г','Смесь сухая для макарон в томатно-мясном соусе болонез Maggi На Второе 30г','Смесь на бумаге для нежного филе куриной грудки по-итальянски Maggi На Второе 30.6г','Суп сухой куриный с вермишелью Maggi 50г','Приправа для филе куриного 30г','Сухарики Три корочки Семга и сыр 60г с соусом тартар 25мл','Креветки королевские варено-мороженые 700г','Пюре Дары Кубани Яблоко банан печенье с 6 месяцев 90г','Каша детская жидкая молочная гречневая Агуша с 6 месяцев 200мл','Картофель фри обжаренный 400г','Свекла вареная очищенная тертая 500г'])assert.equal(api.classifyProduct(name),null,name);
  assert.equal(api.classifyProduct('Смесь овощная свежезамороженная 400г')?.kind,'vegetable');
  assert.equal(api.classifyProduct('Овощная смесь свежая 400г')?.kind,'vegetable');
  assert.equal(api.classifyProduct('Крупа гречневая Увелка 800г')?.kind,'grain');
  assert.equal(api.classifyProduct('Мороженое Гост Сливочное 75г')?.kind,'dessert');
});
test('utensils and prepared foods mentioning ingredients cannot acquire the ingredient culinary class',()=>{
  for(const name of ['Ложка для спагетти DP-60/5','Вилка для макарон','Нож для сыра','Лопатка для риса','Тефтели Троекурово куриные с моцареллой и болгарским перцем охлажденные 450г','Блинчики Папа может круглые с творогом 180г','Наггетсы Стародворье Курушки с ветчиной и сыром 230г','Риет из лосося Меридиан с мягким творогом 100г','Напиток овсяный шоколад Nemoloko 3.2% 1л','Шейка Мясная история сырокопченая нарезка 85г'])assert.equal(api.classifyProduct(name),null,name);
});
test('explicit cream, dried fruit and sesame have an ingredient role with no fresh-fruit portions',()=>{
  for(const name of ['Сливки 20% 500г','Чернослив Восточный Гость 150г','Курага 200г','Изюм 100г','Кунжут Айдиго семена 30г','Семена льна 100г'])assert.equal(api.classifyProduct(name)?.kind,'ingredient',name);
  assert.equal(api.classifyProduct('Семена для посадки льна 30г'),null);
  assert.equal(api.classifyProduct('Корм с семенами льна'),null);
  const r=row({name:'Кунжут Айдиго семена 30г',packGrams:30,packText:'30г'});
  const c=candidate({productName:'КУНЖУТ АЙДИГО 30Г',brand:'Айдиго',barcode:undefined,packGrams:30,quantityText:'30г',macros:{kcal:570,protein:19,fat:49,carbs:12}});
  assert.equal(api.matchProduct(r,[c]).status,'matched');
  assert.equal(api.matchProduct(r,[{...c,productName:'Кунжут Айдиго черный 30г'}]).status,'not-found');
});
test('exclusion policy separates explicitly inedible products from unsupported edible categories',()=>{
  for(const name of ['Ложка для спагетти DP-60/5','Молочко Nivea увлажняющее для тела 100г','Корм для кошек с курицей 100г','Пиво светлое 500г','Детская молочная смесь 400г'])assert.equal(api.isExcludedProduct(name),true,name);
  for(const name of ['Сметана Простоквашино 20% 180г','Приправа Maggi для курицы 30г','Смесь на бумаге для куриного филе Maggi 30г','Минтай тушка 500г','Виноград белый','Свиной окорок 500г'])assert.equal(api.isExcludedProduct(name),false,name);
});
test('unknown food with exact branded identity and complete explicit 100g label can become a generic ingredient',()=>{
  const r=row({name:'Сметана Простоквашино 20% 180г',packGrams:180,packText:'180г'});
  const c=candidate({productName:r.name,brand:'Простоквашино',packGrams:180,quantityText:'180г',macros:{kcal:206,protein:2.5,fat:20,carbs:3.4},evidence:'Пищевая ценность на 100 г: 206 ккал, белки 2.5 г, жиры 20 г, углеводы 3.4 г.'});
  assert.equal(api.matchProduct(r,[c]).status,'matched');
  const food=api.enrichedFood(r,c);assert.ok(food);assert.equal(food.kind,'ingredient');assert.equal(food.category,'Другие продукты');assert.deepEqual(food.macros,c.macros);
  const record={key:api.enrichmentKey(r),listingName:r.name,status:'matched' as const,checkedAt:now.toISOString(),retryAt:now.toISOString(),attempts:1,reason:'Совпадение',candidate:c};
  assert.equal(api.enrichedOffer(r,record,now)?.packGrams,180);
  assert.equal(api.enrichedFood(r,{...c,evidence:undefined}),null);
  assert.equal(api.matchProduct(r,[{...c,productName:'Сметана Простоквашино 15% 180г'}]).status,'not-found');
  assert.equal(api.matchProduct(r,[{...c,packGrams:300,quantityText:'300г'}]).status,'not-found');
  assert.equal(api.matchProduct(row({name:'Сметана',packGrams:180}),[{...c,productName:'Сметана',brand:undefined}]).status,'not-found');
});
test('forged label evidence cannot enrich explicitly excluded products',()=>{
  for(const name of ['Ложка для спагетти DP-60/5','Молочко Nivea для тела 100г','Корм для кошек Felix с курицей 100г','Пиво Балтика светлое 500г']){
    const r=row({name,packGrams:100});const c=candidate({productName:name,brand:undefined,packGrams:100,quantityText:'100г',evidence:'Nutrition per 100g as_sold: 100 kcal, protein 5g, fat 2g, carbs 10g'});
    assert.equal(api.matchProduct(r,[c]).status,'not-found',name);assert.equal(api.enrichedFood(r,c),null,name);
  }
});
test('unsupported raw carcasses can retain exact facts but cannot become edible-pack offers',()=>{
  for(const name of ['Минтай тушка Северная гавань 500г','Цыпленок тушка Петелинка 1500г','Креветки Agama неочищенные в панцире 500г','Говядина Мираторг на кости 500г','Курица Петелинка целая 500г','Индейка Индилайт охлажденная 500г']){
    const r=row({name,packGrams:500,packText:'500г'});const c=candidate({productName:name,brand:undefined,packGrams:500,quantityText:'500г',evidence:'Пищевая ценность на 100 г продукта: белки 20г, жиры 5г, углеводы 0г, 125ккал.'});
    assert.equal(api.matchProduct(r,[c]).status,'matched',name);
    const record={key:api.enrichmentKey(r),listingName:r.name,status:'matched' as const,checkedAt:now.toISOString(),retryAt:now.toISOString(),attempts:1,reason:'Совпадение',candidate:c};
    assert.equal(api.enrichedOffer(r,record,now),null,name);
  }
});
