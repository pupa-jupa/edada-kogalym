import {parseMass,type ProductCandidate} from './product-enrichment.ts';
import {macrosSchema,validateSourceUrl} from './validation.ts';

type RecordValue=Record<string,unknown>;
function record(value:unknown):RecordValue|null{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as RecordValue:null;}
function records(value:unknown):RecordValue[]{return Array.isArray(value)?value.map(record).filter((item):item is RecordValue=>item!==null):[];}
function text(value:unknown):string|undefined{return typeof value==='string'&&value.trim()?value.trim():undefined;}
function numeric(value:unknown):number|undefined{
  if(typeof value!=='string'&&typeof value!=='number')return undefined;
  const literal=String(value).trim();
  return /^\d+(?:[.,]\d+)?$/.test(literal)?Number(literal.replace(',','.')):undefined;
}

/** Parses only the direct main PDP response; internal article IDs are never GTINs. */
export function parseMagnitProduct(raw:unknown,sourceUrl:string,now=new Date()):ProductCandidate|null{
  try{
    const url=new URL(validateSourceUrl(sourceUrl));
    if(url.hostname!=='magnit.ru')return null;
    const id=url.pathname.match(/^\/product\/(\d+)(?:[_-][^/]*)?\/?$/)?.[1];
    const product=record(raw),name=text(product?.name);
    if(!id||!product||!name||String(product.id)!==id||!Number.isFinite(now.getTime()))return null;
    const details=records(product.details),sections=details.filter(section=>section.type==='nutritionFactsType'&&!/^На\s+весь\s+товар$/iu.test(text(section.name)??''));
    // Nuxt also renders whole-product totals. Only that explicit scope is ignored;
    // a second 100-g basis or prepared/drained section remains ambiguous.
    if(sections.length!==1)return null;
    const nutrition=sections[0],heading=text(nutrition.name)??'';
    if(!/^(?:На\s+100\s*г|Пищевая\s+ценность\s+в\s+100\s+граммах)$/iu.test(heading))return null;
    if(/приготовлен|готового|после\s+варки|без\s+(?:заливки|жидкости)|drained|prepared|cooked/iu.test(JSON.stringify(nutrition)))return null;
    const parameters=records(nutrition.parameters);
    const values:Record<string,number|undefined>={};
    for(const [field,label] of Object.entries({kcal:'Ккал',protein:'Белки',fat:'Жиры',carbs:'Углеводы'})){
      const entries=parameters.filter(item=>text(item.name)===label);
      if(entries.length!==1)return null;
      values[field]=numeric(entries[0].value);
    }
    const parsed=macrosSchema.safeParse(values);if(!parsed.success)return null;
    const characteristics=details.filter(section=>section.name==='Характеристики'&&section.type==='tableType').flatMap(section=>records(section.parameters));
    const masses:number[]=[];
    for(const item of characteristics){
      if(item.name!=='Вес, кг'&&item.name!=='Вес, г')continue;
      const value=numeric(item.value);if(value===undefined)return null;
      const grams=value*(item.name==='Вес, кг'?1000:1);
      if(!Number.isFinite(grams)||grams<=0||grams>20000)return null;
      masses.push(grams);
    }
    const titleMass=parseMass(name);if(titleMass!==undefined)masses.push(titleMass);
    if(masses.some(mass=>Math.abs(mass-masses[0])>0.01))return null;
    const packGrams=masses[0];
    const brands=[...new Set(characteristics.filter(item=>item.name==='Бренд').map(item=>text(item.value)).filter((brand):brand is string=>!!brand))];
    if(brands.length>1)return null;
    const evidence=`Magnit PDP ${id}; ${name}; КБЖУ на 100 г исходного продукта. ${JSON.stringify(nutrition)}; ${JSON.stringify(characteristics.filter(item=>['Бренд','Вес, кг','Вес, г'].includes(String(item.name))))}`;
    return {productName:name,brand:brands[0],packGrams,quantityText:packGrams===undefined?undefined:`${packGrams} г`,macros:parsed.data,sourceUrl,nutritionSourceUrl:sourceUrl,quantitySourceUrl:packGrams===undefined?undefined:sourceUrl,observedAt:now.toISOString(),estimated:false,evidence};
  }catch{return null;}
}

/** Decodes only root.data's requested goods-detail entry, never recommendation state. */
export function parseMagnitHtml(html:string,sourceUrl:string,now=new Date()):ProductCandidate|null{
  try{
    const url=new URL(validateSourceUrl(sourceUrl));
    const id=url.hostname==='magnit.ru'?url.pathname.match(/^\/product\/(\d+)(?:[_-][^/]*)?\/?$/)?.[1]:undefined;
    if(!id||html.length>12_000_000)return null;
    const script=html.match(/<script\b(?=[^>]*\bid=["']__NUXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/i)?.[1];
    if(!script)return null;
    const table:unknown=JSON.parse(script);if(!Array.isArray(table)||table.length>250_000)return null;
    const wrappers=new Set(['Reactive','ShallowReactive','Ref','ShallowRef']);
    const reference=(index:unknown):number=>{
      if(typeof index!=='number'||!Number.isInteger(index)||index<0||index>=table.length)throw new Error('Invalid Nuxt reference');
      return index;
    };
    const rawObject=(initial:unknown):RecordValue|null=>{
      const visited=new Set<number>();let index=reference(initial);
      while(true){
        if(visited.has(index)||visited.size>100)return null;visited.add(index);
        const value=table[index];
        if(!Array.isArray(value))return record(value);
        if(value.length!==2||!wrappers.has(String(value[0])))return null;
        index=reference(value[1]);
      }
    };
    const root=rawObject(0),data=root?rawObject(root.data):null;if(!data)return null;
    const entries=Object.entries(data).filter(([key])=>key===`goods-detail:${id}`||key.startsWith(`goods-detail:${id}:`));
    if(entries.length!==1)return null;
    const memo=new Map<number,unknown>();
    const decode=(ref:unknown,depth=0):unknown=>{
      if(ref===-1||ref===-2)return undefined;
      if(ref===-3)return NaN;if(ref===-4)return Infinity;if(ref===-5)return -Infinity;if(ref===-6)return -0;
      const index=reference(ref);if(memo.has(index))return memo.get(index);
      if(depth>100)throw new Error('Nuxt nesting limit');
      const value=table[index];
      if(value===null||typeof value!=='object')return value;
      if(Array.isArray(value)&&typeof value[0]==='string'){
        // Custom reducers are not executed. Unneeded unsupported values disappear.
        memo.set(index,undefined);
        if(value.length!==2||!wrappers.has(value[0]))return undefined;
        const result=decode(value[1],depth+1);memo.set(index,result);return result;
      }
      if(Array.isArray(value)){
        const decoded:unknown[]=[];memo.set(index,decoded);
        for(const item of value)decoded.push(decode(item,depth+1));
        return decoded;
      }
      const decoded:RecordValue=Object.create(null) as RecordValue;memo.set(index,decoded);
      for(const [key,item] of Object.entries(value))decoded[key]=decode(item,depth+1);
      return decoded;
    };
    return parseMagnitProduct(decode(entries[0][1]),sourceUrl,now);
  }catch{return null;}
}
