import {z} from 'zod';
import type {Food,Recipe} from './domain.ts';
import {validateRecipes} from './validation.ts';
const step=z.object({text:z.string().min(2).max(1000),foodIds:z.array(z.string().max(40)).max(10),waterMl:z.number().min(0).max(5000)});
const generated=z.object({name:z.string().min(2).max(160),description:z.string().max(400),emoji:z.string().max(10),minutes:z.number().int().min(3).max(180),ingredients:z.array(z.object({foodId:z.string().max(40),grams:z.number().min(1).max(1500)})).min(1).max(10),steps:z.array(step).min(2).max(10),tags:z.array(z.string().max(40)).max(6)});
const normalized=(text:string)=>text.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е');
type PantryItem={mentioned:RegExp;standalone:RegExp;kind?:string};
// These reject recognizable additions, not every possible meaning of natural text.
// A flavour named on a chocolate/bread label does not supply standalone milk/salt.
const pantry:PantryItem[]=[
 {mentioned:/(?<!\p{L})масл(?:о|а|е|ом|у)(?!\p{L})|\b(?:oil|butter)\b/iu,standalone:/^масло\s|^масло$|^(?:oil|butter)\b/iu},
 {mentioned:/(?<!\p{L})сахар(?:а|у|ом|е)?(?!\p{L})|\bsugar\b/iu,standalone:/^сахар(?!\p{L})|^sugar\b/iu},
 {mentioned:/(?<!\p{L})(?:соль|соли|солью)(?!\p{L})|посол|\bsalt\b/iu,standalone:/^соль(?!\p{L})|^salt\b/iu},
 {mentioned:/перец|перца|перцем|поперч|\bpepper\b/iu,standalone:/^перец|^pepper\b/iu},
 {mentioned:/молок|\bmilk\b/iu,standalone:/^молоко|^milk\b/iu},
 {mentioned:/сметан|\bsour cream\b/iu,standalone:/^сметан|^sour cream\b/iu},
 {mentioned:/(?<!\p{L})сыр(?:а|у|ом)?(?!\p{L})|моцарелл|пармезан|\bcheese\b/iu,standalone:/^сыр(?![а-я])|^моцарелл|^пармезан|^cheese\b/iu,kind:'cheese'},
 {mentioned:/сливк|\bcream\b/iu,standalone:/^сливки|^cream\b/iu},
 {mentioned:/майонез|\bmayonnaise\b/iu,standalone:/^майонез|^mayonnaise\b/iu},
 {mentioned:/соус|кетчуп|горчиц|\b(?:sauce|ketchup|mustard)\b/iu,standalone:/^(?:соус|кетчуп|горчиц|sauce|ketchup|mustard)/iu},
 {mentioned:/специ(?:и|й|ям|ями|ях)(?!\p{L})|приправ(?:а|ы|у|ой|ами|ах|е)(?!\p{L})|пряност|\b(?:spices?|seasoning)\b/iu,standalone:/^(?:специ|приправ|пряност|spice|seasoning)/iu},
 {mentioned:/лимон|\blemon\b/iu,standalone:/^лимон|^lemon\b/iu},
 {mentioned:/чеснок|\bgarlic\b/iu,standalone:/^чеснок|^garlic\b/iu},
 {mentioned:/(?<!\p{L})лук(?:а|ом|у)?(?!\p{L})|\bonion\b/iu,standalone:/^лук(?!\p{L})|^onion\b/iu},
 {mentioned:/(?<!\p{L})мук[ауеи](?!\p{L})|\bflour\b/iu,standalone:/^мука(?!\p{L})|^flour\b/iu},
 {mentioned:/яйц|яиц|\beggs?\b/iu,standalone:/^яйц|^яиц|^egg/iu},
 {mentioned:/укроп|петрушк|базилик|\b(?:dill|parsley|basil)\b/iu,standalone:/^(?:укроп|петрушк|базилик|dill|parsley|basil)/iu},
 {mentioned:/(?<!\p{L})мед(?:а|ом|у)?(?!\p{L})|\bhoney\b/iu,standalone:/^мед(?!\p{L})|^honey\b/iu},
];
const actionPattern=/(?:добав\p{L}*|использ\p{L}*|вле[йя]\p{L}*|всып\p{L}*|полож\p{L}*|смеш\p{L}*|приправ\p{L}*|смажь\p{L}*|полей\p{L}*|посып\p{L}*|add|use|pour|mix)/giu;
function obviousPantryAdditions(text:string,item:PantryItem):string[]{
 const additions:string[]=[];
 for(const clause of normalized(text).split(/[.!?;,](?=\s|$)/u)){
  const actions=[...clause.matchAll(actionPattern)];
  const positive=actions.filter(action=>!/(?:^|\s)не\s*$/u.test(clause.slice(0,action.index)));
  if(actions.length&&!positive.length)continue;
  for(const match of clause.matchAll(new RegExp(item.mentioned.source,item.mentioned.flags+'g'))){
   const prefix=clause.slice(0,match.index),without=Math.max(prefix.lastIndexOf('без '),prefix.lastIndexOf('without '));
   if(without>=0&&!positive.some(action=>action.index>without&&action.index<match.index))continue;
   additions.push(match[0]);
  }
 }
 return [...new Set(additions)];
}
const withoutPackage=(text:string)=>normalized(text).replace(/\d+(?:[.,]\d+)?\s*(?:кг|г|мл|л|шт\.?)(?!\p{L})/gu,'').replace(/\s+/g,' ').trim();
function maskDeclaredFoodNames(text:string,foods:Food[]):string{
 let masked=withoutPackage(text);
 const names=foods.map(food=>withoutPackage(food.name)).filter(Boolean).sort((a,b)=>b.length-a.length);
 for(const name of names){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');masked=masked.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,'gu'),' продукт ');}
 return masked;
}
const singleSpices=[
 {mentioned:/^(?:перец|перца|перцем|поперч\p{L}*)$/u,label:/(?:перец(?:\s+(?:черный|белый|красный|душистый|чили))?|(?:черный|белый|красный|душистый)\s+перец)(?:\s+(?:молотый|горошек|дробленый|сушеный))*$/u},
 {mentioned:/^базилик/u,label:/базилик(?:\s+(?:сушеный|измельченный))*$/u},
 {mentioned:/^укроп/u,label:/укроп(?:\s+(?:сушеный|измельченный))*$/u},
 {mentioned:/^петрушк/u,label:/петрушка(?:\s+(?:сушеная|измельченная))*$/u},
 {mentioned:/^чеснок/u,label:/чеснок(?:\s+(?:сушеный|молотый|гранулированный))*$/u},
];
function suppliesSingleSpice(food:Food,component:string):boolean{
 const name=withoutPackage(food.name);
 if(!/^приправа\s/u.test(name))return false;
 let label=name.replace(/^приправа\s+/u,'');
 const brand=food.brand?normalized(food.brand).replace(/\s+/g,' ').trim():'';
 if(brand&&label.startsWith(brand+' '))label=label.slice(brand.length).trimStart();
 const spice=singleSpices.find(spice=>spice.mentioned.test(component)),match=spice&&label.match(spice.label);
 // Only verified brand text can be removed; remaining words must name one spice.
 return match?.index===0;
}
function rawEndpoint(food:Food):number|undefined{
 if(food.kind==='raw-meat'||food.kind==='raw-prepared')return 74;
 if(food.kind==='raw-seafood')return 63;
 if(food.kind!=='raw-fillet')return undefined;
 return food.allergens.includes('Рыба')||/минта|тун[её]ц|треск|хек|лосос|форел|пангасиус|тилап|рыб/i.test(food.name)?63:74;
}
/** Unknown animal preparation requires a product-role review, not an inferred recipe. */
export function recipePreparationIssue(food:Food):string|undefined{
 if(food.preparation&&food.preparation.kind===food.kind)return undefined;
 if(food.kind&&food.kind!=='ingredient')return undefined;
 const name=normalized(food.name);
 const preparedType=/^(?:лапша|вермишель|макароны|бульон|суп|соус|приправа|чипсы|сухарики|паштет|консервы)(?!\p{L})/u.test(name);
 const explicitRaw=/сыр(?:ой|ая|ое|ые|ым|ую)(?!\p{L})|охлажден|заморож|неочищ|на кости|филе|фарш/u.test(name);
 if(preparedType&&!explicitRaw)return undefined;
 if(!/мяс|говя|говяж|свин|баран|телят|курин|куриц|цыпл|индей|(?<!\p{L})ут(?:к|ин)|гуся|крол|рыб|лосос|форел|треск|минта|тунец|тунца|хек|дорадо|сибас|скумбр|горбуш|осетр|сельд|палтус|кревет|кальмар|мидии|устриц|осьминог|краб|морепродукт/u.test(name))return undefined;
 return `Уточните кулинарную роль и съедобную часть продукта «${food.name}»: название указывает на мясо, рыбу или морепродукты, но не подтверждено, сырой это продукт или готовый. Выберите подходящую роль после проверки упаковки.`.slice(0,500);
}
/** A failed recipe idea is retried automatically; missing product facts need review. */
export function recipeNeedsProductReview(food:Food,reason:string):boolean{
 if(recipePreparationIssue(food))return true;
 if(/жевательн\p{L}*\s+резин|\bchewing gum\b/iu.test(food.name))return true;
 const text=normalized(reason);
 const unknown=/неясн|неизвест|непонятн|уточнит|не уточнен|не указан|не подтвержден|не удалось установить|нет информац|недостаточно информац|без данных|требу\p{L}*\s+(?:уточнен|определен)|слишком общее/u.test(text);
 const productFact=/съедобн|подготов|сыр(?:ой|ая|ое|ые|ым|ую)|готов(?:ый|ая|ое|ые)|термообработ|масс|фасов|идентич|идентифиц|какой это продукт|что это за|тип продукта|вид продукта|название|мяс|рыб|морепродукт/u.test(text);
 return unknown&&productFact;
}
function safeRawInstructions(food:Food,instructions:z.infer<typeof step>[]):boolean{
 const minimum=rawEndpoint(food);if(minimum===undefined)return true;
 const relevant=instructions.filter(instruction=>instruction.foodIds.includes(food.id));
 for(const instruction of relevant){
  const text=normalized(instruction.text);
  const serve=/(?:пода(?:вайте|йте)|ешьте|употреб\p{L}*|попроб\p{L}*|\b(?:serve|eat|taste)\b)/u;
  const raw=/(?:сыр(?:ым|ой|ую|ое|ые|ыми|ого)(?!\p{L})|в сыром виде|без (?:приготовления|термообработки)|\braw\b)/u;
  if(serve.test(text)&&raw.test(text))return false;
  if(/(?:^|\s)не\s+(?:готов|нагрева|вари|отвари|обжари|запека|довед|довод|достига)|без\s+термообработки/u.test(text))return false;
 }
 return relevant.some(instruction=>{
  const text=normalized(instruction.text);
  if(!/(?:готов|нагрева|отвар|вари|туш|обжар|запек|довед|достиг|\b(?:cook|heat|bake|boil)\b)/u.test(text)
   ||!/(?:внутр|в центре|толст\p{L}* кус|термометр|\binternal\b|\bcenter\b|\bcentre\b)/u.test(text))return false;
  return [...text.matchAll(/(?:до|не менее|минимум|температур\p{L}*|\bat least\b|\bto\b)\s*(\d{2,3}(?:[.,]\d+)?)\s*(?:°\s*[cс]|градус\p{L}*|[cс](?!\p{L}))/gu)]
   .some(match=>{const temperature=Number(match[1].replace(',','.'));return temperature>=minimum&&temperature<=100;});
 });
}
/** Checks syntax, references and explicit hazards; it cannot prove culinary semantics. */
export function validateGeneratedBatch(raw:unknown,foods:Food[],targetIds:string[]){
 const body=z.object({recipes:z.array(z.unknown()).max(12),unusableTargets:z.array(z.unknown()).max(12).default([])}).parse(raw);
 const registry=new Map(foods.map(f=>[f.id,f]));const recipes:Recipe[]=[];let rejected=0;
 const diagnosticTargets=new Set([...new Set(targetIds)].filter(id=>registry.has(id)).slice(0,12));
 const rejectionReasons=new Map<string,string>();
 for(const candidate of body.recipes){try{
  const r=generated.parse(candidate),ids=new Set(r.ingredients.map(i=>i.foodId));
  if(ids.size!==r.ingredients.length||[...ids].some(id=>!registry.has(id))||!targetIds.some(id=>ids.has(id)))throw new Error('Недопустимый состав');
  const used=new Set(r.steps.flatMap(s=>s.foodIds));if([...used].some(id=>!ids.has(id))||[...ids].some(id=>!used.has(id)))throw new Error('Шаги не совпадают с составом');
  const ingredients=[...ids].map(id=>registry.get(id)!);
  if(ingredients.some(food=>recipePreparationIssue(food)!==undefined))throw new Error('Уточните подготовку продукта перед созданием рецепта');
  for(const food of ingredients.filter(f=>f.preparation?.useWholeContents))for(const instruction of r.steps.filter(s=>s.foodIds.includes(food.id))){
   for(const clause of normalized(instruction.text).split(/[.!?;,]/u)){
    const removal=/(?:слей|слива|процед|промой|промыва|обсуш|откин|удал\p{L}*\s+(?:соус|заливк|маринад)|без\s+(?:соуса|заливки|маринада))/u;
    if(removal.test(clause)&&!/(?:не|нельзя|запрещено)\s+(?:слива|слей|процеж|процед|промыва|промой|обсуш|откидыва|откин|удаля)/u.test(clause))throw new Error('КБЖУ относятся ко всему продукту с соусом или заливкой; удаление части не учтено');
   }
  }
  const pantrySteps=r.steps.map(instruction=>({...instruction,pantryText:maskDeclaredFoodNames(instruction.text,instruction.foodIds.map(id=>registry.get(id)!))}));
  for(const item of pantry)for(const instruction of pantrySteps)for(const component of obviousPantryAdditions(instruction.pantryText,item)){
   if(!instruction.foodIds.some(id=>{
    const food=registry.get(id)!;return (item.kind!==undefined&&food.kind===item.kind)||item.standalone.test(normalized(food.name))||suppliesSingleSpice(food,component);
   }))throw new Error(`Неучтённый дополнительный продукт «${component}» в шаге: ${instruction.text.replace(/\s+/g,' ').slice(0,200)}`);
  }
  if(ingredients.some(food=>!safeRawInstructions(food,r.steps)))throw new Error('Не подтверждено безопасное приготовление сырого продукта');
  const converted=validateRecipes([{...r,id:'generated',steps:r.steps.map(s=>s.text+(s.waterMl?` Вода: ${s.waterMl} мл.`:''))}],foods.map(f=>f.id))[0];recipes.push(converted);
 }catch(error){
  rejected++;
  const reason=(error instanceof z.ZodError?error.issues.slice(0,3).map(issue=>`${issue.path.join('.')||'recipe'}: ${issue.message}`).join('; '):error instanceof Error?error.message:'Некорректный рецепт').slice(0,400);
  const ingredients=candidate&&typeof candidate==='object'&&'ingredients' in candidate&&Array.isArray(candidate.ingredients)?candidate.ingredients:[];
  for(const ingredient of ingredients){
   const foodId=ingredient&&typeof ingredient==='object'&&'foodId' in ingredient?ingredient.foodId:undefined;
   if(typeof foodId!=='string'||!diagnosticTargets.has(foodId))continue;
   const previous=rejectionReasons.get(foodId);
   rejectionReasons.set(foodId,previous&&!previous.includes(reason)?`${previous}; ${reason}`.slice(0,400):previous??reason);
  }
 }}
 const unusedSchema=z.object({foodId:z.string().min(1).max(40),reason:z.string().trim().min(3).max(500)});
 const unusable=new Map<string,{foodId:string;reason:string}>();
 for(const candidate of body.unusableTargets){const parsed=unusedSchema.safeParse(candidate);if(!parsed.success)continue;const target=parsed.data;if(targetIds.includes(target.foodId)&&!recipes.some(recipe=>recipe.ingredients.some(ingredient=>ingredient.foodId===target.foodId)))unusable.set(target.foodId,target);}
 for(const foodId of targetIds){const food=registry.get(foodId);if(!food)continue;const reason=recipePreparationIssue(food);if(reason)unusable.set(foodId,{foodId,reason});}
 return {recipes,rejected,unusableTargets:[...unusable.values()],rejectionReasons:[...rejectionReasons].map(([foodId,reason])=>({foodId,reason}))};
}
export function generationSchema(foodIds:string[]){
 // Repeated long ID enums cause Google's grammar compiler to reject otherwise
 // valid large catalogues. The full allowlist is always enforced after generation.
 const id=foodIds.length<=12?{type:'string',enum:foodIds}:{type:'string'};
 const ingredient={type:'object',properties:{foodId:id,grams:{type:'number'}},required:['foodId','grams']};
 const instruction={type:'object',properties:{text:{type:'string'},foodIds:{type:'array',items:id},waterMl:{type:'number'}},required:['text','foodIds','waterMl']};
 const recipe={type:'object',properties:{name:{type:'string'},description:{type:'string'},emoji:{type:'string'},minutes:{type:'integer'},ingredients:{type:'array',items:ingredient},steps:{type:'array',items:instruction},tags:{type:'array',items:{type:'string'}}},required:['name','description','emoji','minutes','ingredients','steps','tags']};
 const unused={type:'object',properties:{foodId:id,reason:{type:'string'}},required:['foodId','reason']};
 return {type:'object',properties:{recipes:{type:'array',maxItems:12,items:recipe},unusableTargets:{type:'array',items:unused}},required:['recipes','unusableTargets']};
}
