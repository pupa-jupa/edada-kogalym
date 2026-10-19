import type { Food, Recipe, Store } from './domain.ts';

// Справочные значения на 100 г сырой съедобной части. Для расчёта используются
// значения конкретного предложения, а эти значения — только справочные.
export const FOODS: Food[] = [
  { id: 'chicken', name: 'Куриное филе', emoji: '🍗', category: 'Мясо и рыба', macros: { kcal: 113, protein: 23.6, fat: 1.9, carbs: 0 }, allergens: [] },
  { id: 'turkey', name: 'Филе индейки', emoji: '🦃', category: 'Мясо и рыба', macros: { kcal: 114, protein: 23.7, fat: 1.5, carbs: 0 }, allergens: [] },
  { id: 'pollock', name: 'Филе минтая', emoji: '🐟', category: 'Мясо и рыба', macros: { kcal: 72, protein: 15.9, fat: 0.9, carbs: 0 }, allergens: ['Рыба'] },
  { id: 'tuna', name: 'Филе тунца', emoji: '🐟', category: 'Мясо и рыба', macros: { kcal: 101, protein: 23, fat: 1, carbs: 0 }, allergens: ['Рыба'] },
  { id: 'egg', name: 'Яйцо куриное, без скорлупы', emoji: '🥚', category: 'Яйца и молочное', macros: { kcal: 157, protein: 12.7, fat: 11.5, carbs: 0.7 }, allergens: ['Яйца'] },
  { id: 'cottage', name: 'Творог 5%', emoji: '🥣', category: 'Яйца и молочное', macros: { kcal: 121, protein: 17, fat: 5, carbs: 1.8 }, allergens: ['Молоко'] },
  { id: 'cottage-fatfree', name: 'Творог обезжиренный', emoji: '🥣', category: 'Яйца и молочное', macros: { kcal: 85, protein: 18, fat: 0.5, carbs: 2 }, allergens: ['Молоко'] },
  { id: 'cottage-grained', name: 'Творог зернёный в сливках 5%', emoji: '🥣', category: 'Яйца и молочное', macros: { kcal: 103, protein: 11, fat: 5, carbs: 3.5 }, allergens: ['Молоко'] },
  { id: 'milk', name: 'Молоко 2,5%', emoji: '🥛', category: 'Яйца и молочное', macros: { kcal: 52, protein: 2.8, fat: 2.5, carbs: 4.7 }, allergens: ['Молоко'] },
  { id: 'kefir', name: 'Кефир 1%', emoji: '🥛', category: 'Яйца и молочное', macros: { kcal: 40, protein: 3, fat: 1, carbs: 4 }, allergens: ['Молоко'] },
  { id: 'buckwheat', name: 'Гречка сухая', emoji: '🌾', category: 'Крупы и бобовые', macros: { kcal: 308, protein: 12.6, fat: 3.3, carbs: 57.1 }, allergens: [] },
  { id: 'rice', name: 'Рис сухой', emoji: '🍚', category: 'Крупы и бобовые', macros: { kcal: 344, protein: 6.7, fat: 0.7, carbs: 78.9 }, allergens: [] },
  { id: 'oats', name: 'Овсяные хлопья', emoji: '🥣', category: 'Крупы и бобовые', macros: { kcal: 352, protein: 12.3, fat: 6.2, carbs: 61.8 }, allergens: ['Возможен глютен'] },
  { id: 'pasta', name: 'Макароны сухие', emoji: '🍝', category: 'Крупы и бобовые', macros: { kcal: 350, protein: 12, fat: 1.5, carbs: 72 }, allergens: ['Пшеница (глютен)'] },
  { id: 'lentils', name: 'Чечевица красная сухая', emoji: '🫘', category: 'Крупы и бобовые', macros: { kcal: 310, protein: 24, fat: 1.5, carbs: 46.3 }, allergens: [] },
  { id: 'potato', name: 'Картофель очищенный', emoji: '🥔', category: 'Овощи и фрукты', macros: { kcal: 77, protein: 2, fat: 0.4, carbs: 16.3 }, allergens: [] },
  { id: 'carrot', name: 'Морковь очищенная', emoji: '🥕', category: 'Овощи и фрукты', macros: { kcal: 35, protein: 1.3, fat: 0.1, carbs: 6.9 }, allergens: [] },
  { id: 'onion', name: 'Лук репчатый очищенный', emoji: '🧅', category: 'Овощи и фрукты', macros: { kcal: 41, protein: 1.4, fat: 0.2, carbs: 8.2 }, allergens: [] },
  { id: 'cabbage', name: 'Капуста белокочанная', emoji: '🥬', category: 'Овощи и фрукты', macros: { kcal: 28, protein: 1.8, fat: 0.1, carbs: 4.7 }, allergens: [] },
  { id: 'tomato', name: 'Помидоры', emoji: '🍅', category: 'Овощи и фрукты', macros: { kcal: 20, protein: 1.1, fat: 0.2, carbs: 3.7 }, allergens: [] },
  { id: 'cucumber', name: 'Огурцы', emoji: '🥒', category: 'Овощи и фрукты', macros: { kcal: 14, protein: 0.8, fat: 0.1, carbs: 2.5 }, allergens: [] },
  { id: 'apple', name: 'Яблоки без сердцевины', emoji: '🍎', category: 'Овощи и фрукты', macros: { kcal: 47, protein: 0.4, fat: 0.4, carbs: 9.8 }, allergens: [] },
  { id: 'oil', name: 'Масло подсолнечное', emoji: '🫙', category: 'Бакалея', macros: { kcal: 899, protein: 0, fat: 99.9, carbs: 0 }, allergens: [] },
];

export const STORES: Store[] = [
  { id: '5ka', name: 'Пятёрочка', short: '5', color: '#df302d', url: 'https://5ka.ru',address:'ул. Мира, 15Б',locationSource:'https://2gis.ru/kogalym/firm/70000001078841892',locationNote:'Доступны акции городского каталога Когалыма. Остатки и цена конкретной торговой точки не проверены.' },
  { id: 'svetofor', name: 'Светофор', short: 'С', color: '#e4ae19', url: 'https://svetofor-nsk.ru',address:'ул. Прибалтийская, 61А/1 — уточните перед поездкой',locationSource:'https://2gis.ru/kogalym/firm/70000001083402624',locationNote:'В справочниках и региональном сайте разные адреса. Текущих подтверждённых цен пока нет.' },
  { id: 'magnit', name: 'Магнит', short: 'М', color: '#d92832', url: 'https://magnit.ru',address:'ул. Дружбы народов, 60, СКК «Галактика»',locationSource:'https://skk-galaxy.ru/shops/magnit.html',locationNote:'Доступны акции городского каталога Когалыма. Остатки и цена конкретной торговой точки не проверены.' },
  { id: 'perekrestok', name:'Перекрёсток',short:'П',color:'#168554',url:'https://www.perekrestok.ru',address:'ул. Ленинградская, 29, ТЦ «Надежда»',locationSource:'https://www.perekrestok.ru/shops/shop/890',locationNote:'Магазин подтверждён официальной карточкой. Текущие местные цены ещё не найдены.',active:true },
  { id: 'monetka', name:'Монетка',short:'Мо',color:'#1a8b49',url:'https://www.monetka.ru',address:'ул. Югорская, 30Б',locationSource:'https://2gis.ru/kogalym/firm/70000001034242589',locationNote:'Доступны акции городского каталога Когалыма. Остатки и цена конкретной торговой точки не проверены.',active:true },
];

export const RECIPES: Recipe[] = [
  {
    id:'curd-oats-water',name:'Овсянка с обезжиренным творогом',description:'Хлопья варятся на воде; творог добавляется после варки.',emoji:'🥣',minutes:15,
    ingredients:[{foodId:'oats',grams:50},{foodId:'cottage-fatfree',grams:180}],
    steps:['Залейте хлопья 200 мл воды на порцию. Варите по инструкции на упаковке, помешивая.','Снимите с огня, дайте каше немного остыть. Добавьте творог и перемешайте.'],tags:['Завтрак','Без мяса'],
  },
  {
    id:'grain-curd-cucumber',name:'Зернёный творог с огурцом',description:'Быстрое холодное блюдо из двух ингредиентов.',emoji:'🥒',minutes:5,
    ingredients:[{foodId:'cottage-grained',grams:200},{foodId:'cucumber',grams:120}],
    steps:['Вымойте огурец, взвесьте нужную порцию и нарежьте небольшими кубиками.','Смешайте с зернёным творогом. Подавайте сразу.'],tags:['Быстро','Без мяса'],
  },
  {
    id:'pollock-rice-water',name:'Минтай с рисом и морковью',description:'Рыба тушится с морковью на воде; рис взвешивается сухим.',emoji:'🍚',minutes:30,
    ingredients:[{foodId:'pollock',grams:200},{foodId:'rice',grams:60},{foodId:'carrot',grams:80}],
    steps:['Заранее разморозьте филе в холодильнике. Отварите рис по инструкции на упаковке.','Очищенную морковь нарежьте, добавьте в сотейник 100 мл воды на порцию. Тушите под крышкой 8 минут.','Положите филе на морковь, накройте крышкой и готовьте 12–15 минут, подливая воду. Проверьте готовность рыбы: 63 °C в центре. Подавайте с рисом.'],tags:['Рыба','Без масла'],
  },
  {
    id:'pollock-buckwheat-water',name:'Гречка с минтаем',description:'Сухая крупа и сырое филе готовятся в сотейнике с водой.',emoji:'🍲',minutes:30,
    ingredients:[{foodId:'pollock',grams:200},{foodId:'buckwheat',grams:60},{foodId:'carrot',grams:60}],
    steps:['Заранее разморозьте филе. Промойте гречку; очищенную морковь натрите.','Положите гречку и морковь в сотейник, залейте 180 мл воды на порцию. Готовьте под крышкой 8 минут.','Добавьте филе, готовьте ещё 12–15 минут до мягкости гречки и 63 °C в центре рыбы. Подливайте воду, если необходимо.'],tags:['Рыба','Одна посуда'],
  },
  {
    id:'tuna-potato-water',name:'Тунец с картофелем',description:'Отварной картофель и филе, приготовленное под крышкой.',emoji:'🐟',minutes:30,
    ingredients:[{foodId:'tuna',grams:180},{foodId:'potato',grams:200},{foodId:'carrot',grams:60}],
    steps:['Заранее разморозьте тунец в холодильнике. Очищенные картофель и морковь нарежьте, варите в воде 15–20 минут до мягкости.','Филе положите в небольшой сотейник со 100 мл воды на порцию. Готовьте под крышкой на слабом огне до 63 °C в центре, перевернув один раз. Подавайте с овощами.'],tags:['Рыба','Без масла'],
  },
  {
    id: 'chicken-buckwheat', name: 'Гречка с курицей и морковью', description: 'Филе и крупа в одной сковороде. Вес крупы указан до варки.', emoji: '🍲', minutes: 30,
    ingredients: [{ foodId: 'chicken', grams: 180 }, { foodId: 'buckwheat', grams: 60 }, { foodId: 'carrot', grams: 60 }, { foodId: 'onion', grams: 30 }, { foodId: 'oil', grams: 5 }],
    steps: ['Взвесьте сырые очищенные ингредиенты; промойте гречку. Нарежьте филе и овощи.', 'В глубокой сковороде прогрейте масло, готовьте овощи 3 минуты. Добавьте филе и готовьте ещё 5 минут.', 'Добавьте гречку и 150 мл воды на порцию, накройте крышкой. Томите 18–20 минут, при необходимости подливая воду. Проверьте готовность курицы: 74 °C в центре самого толстого кусочка.'], tags: ['Одна сковорода', 'Много белка'],
  },
  {
    id: 'turkey-rice', name: 'Рис с индейкой', description: 'Нежная индейка с рисом и овощами.', emoji: '🍚', minutes: 30,
    ingredients: [{ foodId: 'turkey', grams: 180 }, { foodId: 'rice', grams: 60 }, { foodId: 'carrot', grams: 70 }, { foodId: 'oil', grams: 5 }],
    steps: ['Промойте рис и варите в воде до готовности по инструкции на упаковке.', 'Нарежьте сырую индейку небольшими кусочками, морковь натрите. Выложите в сковороду с маслом и 60 мл воды на порцию.', 'Тушите под крышкой 18–20 минут, помешивая. Проверьте температуру индейки: 74 °C в центре. Смешайте с готовым рисом.'], tags: ['Много белка'],
  },
  {
    id: 'pollock-potato', name: 'Минтай с картофелем под крышкой', description: 'Рыба и мягкие овощи без духовки.', emoji: '🐟', minutes: 35,
    ingredients: [{ foodId: 'pollock', grams: 200 }, { foodId: 'potato', grams: 180 }, { foodId: 'carrot', grams: 50 }, { foodId: 'onion', grams: 30 }, { foodId: 'oil', grams: 5 }],
    steps: ['Полностью разморозьте филе заранее. Взвесьте съедобную часть, удалите косточки. Картофель нарежьте тонкими кружками.', 'Выложите овощи в смазанную маслом глубокую сковороду, добавьте 100 мл воды на порцию. Тушите под крышкой 15 минут.', 'Сверху положите кусочки рыбы. Готовьте ещё 12–15 минут: картофель должен стать мягким, температура рыбы в центре — 63 °C.'], tags: ['Рыба', 'Без духовки'],
  },
  {
    id: 'lentil-soup', name: 'Густой суп из красной чечевицы', description: 'Сытный овощной суп с растительным белком.', emoji: '🥣', minutes: 30,
    ingredients: [{ foodId: 'lentils', grams: 90 }, { foodId: 'carrot', grams: 60 }, { foodId: 'onion', grams: 40 }, { foodId: 'tomato', grams: 80 }, { foodId: 'oil', grams: 5 }],
    steps: ['Промойте сухую чечевицу; нарежьте очищенные овощи.', 'В кастрюле с маслом прогрейте лук и морковь 3 минуты. Добавьте помидор, чечевицу и 400 мл воды на порцию.', 'Варите на небольшом огне 20–25 минут до полной мягкости чечевицы. При необходимости добавьте воды.'], tags: ['Без мяса', 'Растительный белок'],
  },
  {
    id: 'chicken-pasta', name: 'Макароны с курицей и томатами', description: 'Простой томатный соус из свежих помидоров.', emoji: '🍝', minutes: 25,
    ingredients: [{ foodId: 'chicken', grams: 170 }, { foodId: 'pasta', grams: 70 }, { foodId: 'tomato', grams: 120 }, { foodId: 'onion', grams: 30 }, { foodId: 'oil', grams: 5 }],
    steps: ['Отварите сухие макароны в воде по инструкции, сохраните немного воды от варки.', 'Нарежьте филе мелкими кусочками. На масле готовьте его с луком 5 минут. Добавьте нарезанные помидоры и немного воды.', 'Тушите 12–15 минут до готовности курицы (74 °C в центре). Добавьте макароны, перемешайте и прогрейте.'], tags: ['Много белка', 'Быстро'],
  },
  {
    id: 'cottage-oats', name: 'Овсяная каша с творогом и яблоком', description: 'Творог добавляется в готовую тёплую кашу.', emoji: '🥣', minutes: 15,
    ingredients: [{ foodId: 'oats', grams: 45 }, { foodId: 'milk', grams: 150 }, { foodId: 'cottage', grams: 150 }, { foodId: 'apple', grams: 100 }],
    steps: ['Взвесьте сухие хлопья, молоко, творог и яблоко без сердцевины.', 'Смешайте молоко со 100 мл воды на порцию, доведите до кипения. Всыпьте хлопья и варите по инструкции на упаковке, помешивая.', 'Снимите с огня, дайте немного остыть. Добавьте творог и натёртое яблоко, перемешайте.'], tags: ['Завтрак', 'Без мяса'],
  },
  {
    id: 'tomato-omelet', name: 'Омлет с творогом и помидорами', description: 'Вес яиц — без скорлупы; 100 г примерно соответствуют двум средним яйцам.', emoji: '🍳', minutes: 15,
    ingredients: [{ foodId: 'egg', grams: 100 }, { foodId: 'cottage', grams: 100 }, { foodId: 'tomato', grams: 100 }, { foodId: 'oil', grams: 5 }],
    steps: ['Разбейте яйца и взвесьте массу без скорлупы. Перемешайте с творогом.', 'Нарежьте помидоры, прогрейте на сковороде с маслом 2 минуты.', 'Влейте яичную смесь, накройте крышкой. Готовьте на слабом огне 8–10 минут до полного схватывания яиц.'], tags: ['Завтрак', 'Без мяса', 'Быстро'],
  },
  {
    id: 'chicken-cabbage', name: 'Капуста, тушённая с курицей', description: 'Овощное блюдо с большой порцией филе.', emoji: '🥬', minutes: 35,
    ingredients: [{ foodId: 'chicken', grams: 200 }, { foodId: 'cabbage', grams: 200 }, { foodId: 'carrot', grams: 50 }, { foodId: 'onion', grams: 30 }, { foodId: 'oil', grams: 5 }],
    steps: ['Нашинкуйте капусту, нарежьте морковь, лук и сырое филе.', 'Прогрейте масло, готовьте курицу с луком 5 минут.', 'Добавьте остальные овощи и 80 мл воды на порцию. Тушите под крышкой 25 минут, помешивая, до мягкости капусты и готовности курицы (74 °C в центре).'], tags: ['Много белка', 'Одна сковорода'],
  },
  {
    id: 'lentil-buckwheat', name: 'Гречка с чечевицей и овощами', description: 'Две крупы для простого обеда без мяса.', emoji: '🫘', minutes: 30,
    ingredients: [{ foodId: 'buckwheat', grams: 50 }, { foodId: 'lentils', grams: 60 }, { foodId: 'carrot', grams: 60 }, { foodId: 'onion', grams: 30 }, { foodId: 'oil', grams: 5 }],
    steps: ['Промойте гречку и красную чечевицу, нарежьте овощи.', 'В сотейнике с маслом прогрейте овощи 3 минуты. Добавьте гречку и 150 мл воды на порцию, готовьте 8 минут.', 'Добавьте чечевицу и ещё 150 мл воды на порцию. Томите 15–18 минут до мягкости круп и чечевицы; подливайте воду при необходимости.'], tags: ['Без мяса', 'Растительный белок'],
  },
  {
    id: 'potato-egg', name: 'Картофельная сковорода с яйцом', description: 'Отварной картофель и полностью приготовленные яйца.', emoji: '🥔', minutes: 30,
    ingredients: [{ foodId: 'potato', grams: 180 }, { foodId: 'egg', grams: 100 }, { foodId: 'tomato', grams: 100 }, { foodId: 'oil', grams: 5 }],
    steps: ['Нарежьте очищенный картофель небольшими кубиками и варите в воде 12–15 минут до мягкости. Слейте воду.', 'Выложите картофель и помидоры на сковороду с маслом. Готовьте 3 минуты.', 'Взвесьте яйца без скорлупы, взбейте и влейте в сковороду. Накройте крышкой и готовьте 6–8 минут до полного схватывания яиц.'], tags: ['Без мяса', 'Одна сковорода'],
  },
];
