import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../lib/retailer-reference.ts';

const now=new Date('2026-10-19T14:00:00Z');
const source='https://magnit.ru/product/3174070007_makarony_shebekinskie_rozhki_450g';
// Direct PDP API shape retained from work/bulk-magnit-api-pdp.json.
const product=()=>({
  id:'3174070007',name:'Макароны Шебекинские №202 Рожок полубублик 450г',
  pageUrl:'https://magnit.ru/product/3174070007?shopCode=992301&shopType=dostavka',
  details:[
    {name:'Пищевая ценность в 100 граммах',type:'nutritionFactsType',parameters:[{name:'Ккал',value:'350'},{name:'Белки',value:'13'},{name:'Жиры',value:'1.5'},{name:'Углеводы',value:'72'}]},
    {name:'Описание',type:'stringType',value:'Макароны при варке не слипаются.',parameters:[]},
    {name:'Характеристики',type:'tableType',parameters:[{name:'Бренд',value:'Шебекинские'},{name:'Производитель',value:'Италлинк'},{name:'Вес, кг',value:'0.45'},{name:'Артикул',value:'3174070007'}]},
  ],
  multicard:{name:'Макаронные изделия Шебекинские',features:[{variants:[{isSelected:false,precalculatedGood:'1000123395',title:'Спирали'}]}]},
});

test('Magnit main PDP retains exact product identity, explicit nutrition, mass and primary provenance',()=>{
  assert.equal(typeof api.parseMagnitProduct,'function');
  const result=api.parseMagnitProduct(product(),source,now);
  assert.ok(result);assert.equal(result.productName,'Макароны Шебекинские №202 Рожок полубублик 450г');
  assert.equal(result.brand,'Шебекинские');assert.equal(result.barcode,undefined);assert.equal(result.packGrams,450);
  assert.deepEqual(result.macros,{kcal:350,protein:13,fat:1.5,carbs:72});
  assert.equal(result.sourceUrl,source);assert.equal(result.nutritionSourceUrl,source);assert.equal(result.quantitySourceUrl,source);
  assert.equal(result.observedAt,now.toISOString());assert.equal(result.estimated,false);
  assert.match(result.evidence!,/3174070007/);assert.match(result.evidence!,/100 граммах/);assert.match(result.evidence!,/350/);
});

test('Magnit parser rejects foreign sources and mismatched primary product IDs without searching recommendations',()=>{
  assert.equal(typeof api.parseMagnitProduct,'function');
  for(const url of ['https://evil.example/product/3174070007','https://magnit.ru.evil.example/product/3174070007','http://magnit.ru/product/3174070007','https://user:secret@magnit.ru/product/3174070007','https://magnit.ru:444/product/3174070007','https://magnit.ru/catalog/3174070007','https://magnit.ru/product/31740700070'])assert.equal(api.parseMagnitProduct(product(),url,now),null,url);
  const wrong={...product(),id:'1000123395',recommendations:[product()]};
  assert.equal(api.parseMagnitProduct(wrong,source,now),null);
  for(const raw of [null,[],{product:product()},{...product(),name:''},{...product(),id:undefined}])assert.equal(api.parseMagnitProduct(raw,source,now),null);
});

test('Magnit nutrition requires a single explicit as-sold 100 gram section with all valid values',()=>{
  assert.equal(typeof api.parseMagnitProduct,'function');
  for(const name of ['На 100 мл','На 100 г готового продукта','На 100 г после приготовления','На 100 г без заливки','На порцию','Пищевая ценность']){
    const p=product();p.details[0].name=name;assert.equal(api.parseMagnitProduct(p,source,now),null,name);
  }
  for(const value of ['',null,'1 г','NaN','101',false]){
    const p=product();const parameters=p.details[0].parameters as {name:string;value:unknown}[];parameters[1].value=value;
    assert.equal(api.parseMagnitProduct(p,source,now),null,String(value));
  }
  const missing=product();missing.details[0].parameters.pop();assert.equal(api.parseMagnitProduct(missing,source,now),null);
  const duplicate=product();duplicate.details.push(duplicate.details[0]);assert.equal(api.parseMagnitProduct(duplicate,source,now),null);
  const related={...product(),details:product().details.slice(1),recommendations:[product()]};assert.equal(api.parseMagnitProduct(related,source,now),null);
  const grams=product();grams.details[0].name='На 100 г';grams.details[0].parameters[2].value='1,5';assert.deepEqual(api.parseMagnitProduct(grams,source,now)?.macros,{kcal:350,protein:13,fat:1.5,carbs:72});
});

test('Magnit package facts use literal declared mass without density or internal article barcode inference',()=>{
  assert.equal(typeof api.parseMagnitProduct,'function');
  const p=product();p.name='Макароны Рожок полубублик';p.details[2].parameters[2]={name:'Вес, г',value:'450'};
  const result=api.parseMagnitProduct(p,source,now);assert.equal(result?.productName,p.name);assert.equal(result?.brand,'Шебекинские');assert.equal(result?.packGrams,450);assert.equal(result?.quantityText,'450 г');assert.equal(result?.barcode,undefined);
  const comma=product();comma.details[2].parameters[2].value='0,45';assert.equal(api.parseMagnitProduct(comma,source,now)?.packGrams,450);
  const volume=product();volume.name='Напиток овсяный 450мл';volume.details[2].parameters[2]={name:'Объем, л',value:'0.45'};assert.equal(api.parseMagnitProduct(volume,source,now)?.packGrams,undefined);
  const noMass=product();noMass.name='Макароны Рожок полубублик';noMass.details[2].parameters.pop();noMass.details[2].parameters.pop();assert.equal(api.parseMagnitProduct(noMass,source,now)?.packGrams,undefined);
  const conflict=product();conflict.details[2].parameters[2].value='0.4';assert.equal(api.parseMagnitProduct(conflict,source,now),null);
});

// Public devalue table shape: objects and arrays contain table references.
function nuxtTable(value:unknown):unknown[]{
  const table:unknown[]=[],seen=new Map<unknown,number>();
  const flatten=(item:unknown):number=>{
    if(seen.has(item))return seen.get(item)!;
    const index=table.length;seen.set(item,index);table.push(null);
    if(item!==null&&typeof item==='object')table[index]=Array.isArray(item)?item.map(flatten):Object.fromEntries(Object.entries(item).map(([key,entry])=>[key,flatten(entry)]));
    else table[index]=item;
    return index;
  };
  flatten(value);return table;
}
const nuxtHtml=(table:unknown[])=>`<html><script type="application/json" id="__NUXT_DATA__">${JSON.stringify(table)}</script></html>`;
const mainKey='goods-detail:3174070007:992301:dostavka:3';

test('Magnit HTML decodes the matching main Nuxt PDP through the direct parser',()=>{
  assert.equal(typeof api.parseMagnitHtml,'function');
  const table=nuxtTable({data:{[mainKey]:product()},state:{recommendations:[{...product(),name:'Похожий товар'}]}});
  // Nuxt wraps root/data in reactive tags rather than inline JSON objects.
  const rootIndex=table.length;table.push(table[0]);table[0]=['ShallowReactive',rootIndex];
  const root=table[rootIndex] as Record<string,number>;const dataIndex=table.length;table.push(table[root.data]);table[root.data]=['Reactive',dataIndex];
  const result=api.parseMagnitHtml(nuxtHtml(table),source,now);
  assert.ok(result);assert.equal(result.productName,'Макароны Шебекинские №202 Рожок полубублик 450г');assert.equal(result.packGrams,450);
  assert.deepEqual(result.macros,{kcal:350,protein:13,fat:1.5,carbs:72});assert.equal(result.barcode,undefined);assert.equal(result.sourceUrl,source);
});

test('Magnit Nuxt whole-product totals cannot replace or invalidate the explicit 100 gram section',()=>{
  const p=product();p.details.splice(1,0,{name:'На весь товар',type:'nutritionFactsType',parameters:[{name:'Ккал',value:'1575'},{name:'Белки',value:'58.5'},{name:'Жиры',value:'6.8'},{name:'Углеводы',value:'324'}]});
  const result=api.parseMagnitHtml(nuxtHtml(nuxtTable({data:{[mainKey]:p}})),source,now);
  assert.deepEqual(result?.macros,{kcal:350,protein:13,fat:1.5,carbs:72});
  p.details.shift();assert.equal(api.parseMagnitHtml(nuxtHtml(nuxtTable({data:{[mainKey]:p}})),source,now),null);
});

test('Magnit HTML ignores recommendations and rejects non-PDP, wrong IDs and malformed references',()=>{
  assert.equal(typeof api.parseMagnitHtml,'function');
  for(const data of [{recommendations:[product()]},{'goods-detail:1000123395:store':product()},{[mainKey]:{...product(),id:'1000123395'}}])assert.equal(api.parseMagnitHtml(nuxtHtml(nuxtTable({data})),source,now),null);
  for(const table of [[{data:99}],[{data:1},{[mainKey]:999}],[{data:1},{[mainKey]:1.5}],[['ShallowReactive',0]],[{data:1},['UnsupportedRoot',2],product()]])assert.equal(api.parseMagnitHtml(nuxtHtml(table),source,now),null);
  assert.equal(api.parseMagnitHtml('<script id="__NUXT_DATA__">not json</script>',source,now),null);
  assert.equal(api.parseMagnitHtml('<h1>Макароны</h1>',source,now),null);
  const incomplete=product();incomplete.details[0].parameters.pop();
  assert.equal(api.parseMagnitHtml(nuxtHtml(nuxtTable({data:{[mainKey]:incomplete},recommendations:[product()]})),source,now),null);
});

test('Magnit HTML skips unsupported tags and unrelated state, caches cycles and cannot pollute prototypes',()=>{
  assert.equal(typeof api.parseMagnitHtml,'function');
  const p={...product(),extra:undefined as unknown,cycle:undefined as unknown};p.cycle=p;
  Object.defineProperty(p,'__proto__',{value:{polluted:'yes'},enumerable:true});
  const table=nuxtTable({data:{[mainKey]:p},state:{bad:'not needed'}});
  const root=table[0] as Record<string,number>;root.state=99999;
  const data=table[root.data] as Record<string,number>,main=table[data[mainKey]] as Record<string,number>;
  main.extra=table.length;table.push(['UnsupportedCustom',99999]);
  assert.ok(api.parseMagnitHtml(nuxtHtml(table),source,now));
  assert.equal(Object.getOwnPropertyDescriptor(Object.prototype,'polluted'),undefined);
});
