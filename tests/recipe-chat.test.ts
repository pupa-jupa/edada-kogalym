import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRecipeChatRequest,reserveRecipeChatCall,recipeChatQuota,capRecipeChatMessages,selectChatFoods,validateRecipeChatReply,recipeChatGenerationConfig,type RecipeChatMessage} from '../lib/recipe-chat.ts';
import type {Food} from '../lib/domain.ts';
import {DEFAULT_INPUT} from '../lib/domain.ts';
const now=new Date('2026-10-19T20:00:00Z');
const foods:Food[]=[{id:'oats',name:'Хлопья овсяные',kind:'grain',category:'Крупы',emoji:'🌾',allergens:[],macros:{kcal:350,protein:13,fat:6,carbs:60}},{id:'sesame',name:'Кунжут',kind:'ingredient',category:'Семена',emoji:'🌱',allergens:[],macros:{kcal:570,protein:19,fat:49,carbs:12}}];
const recipe={name:'Каша с кунжутом',description:'На воде',emoji:'🥣',minutes:15,ingredients:[{foodId:'oats',grams:60},{foodId:'sesame',grams:10}],steps:[{text:'Отварите хлопья в воде.',foodIds:['oats'],waterMl:200},{text:'Добавьте кунжут.',foodIds:['sesame'],waterMl:0}],tags:['Завтрак']};
test('chat validates before spending and reset cannot carry a hidden paid message',()=>{
 assert.deepEqual(parseRecipeChatRequest({message:'  Заменить завтрак  ',planId:'plan-1'}),{message:'Заменить завтрак',planId:'plan-1'});
 for(const invalid of [{message:' '},{message:'x'.repeat(2001)},{message:'Привет',reset:true},{reset:false},{message:'x',model:'other'}])assert.throws(()=>parseRecipeChatRequest(invalid));
 assert.deepEqual(parseRecipeChatRequest({reset:true}),{reset:true});
});
test('chat accepts the current form constraints and rejects invalid overrides before spending',()=>{
 const input={...DEFAULT_INPUT,budget:450,proteinMin:90,excludedFoodIds:['sesame']};
 const parsed=parseRecipeChatRequest({message:'Другой завтрак',planId:'old-plan',input});
 assert.ok('input' in parsed);assert.deepEqual(parsed.input,input);
 for(const invalid of [{...input,budget:0},{...input,storeIds:[]},{...input,demo:true},{...input,proteinMin:999}])assert.throws(()=>parseRecipeChatRequest({message:'Замена',input:invalid}));
});
test('chat quota persists failed attempts and resets at midnight in Kogalym',()=>{
 const reserved=reserveRecipeChatCall({messages:[],day:'2026-10-19',usedCalls:20,dailyLimit:20},now);
 assert.equal(reserved.usedCalls,1);assert.equal(reserved.day,'2026-10-20');
 assert.throws(()=>reserveRecipeChatCall({...reserved,usedCalls:20},now),/лимит/i);
 assert.deepEqual(recipeChatQuota({...reserved,usedCalls:3},now),{dailyUsed:3,dailyLimit:20});
});
test('conversation keeps a bounded recent context without splitting complete turns',()=>{
 const messages:RecipeChatMessage[]=Array.from({length:30},(_,i)=>({id:String(i),role:i%2?'assistant':'user',text:'x'.repeat(2000),createdAt:now.toISOString()}));
 const capped=capRecipeChatMessages(messages);
 assert.equal(capped.at(-1)?.id,'29');assert.equal(capped[0]?.role,'user');
 assert.ok(capped.length<=24);assert.ok(capped.reduce((sum,m)=>sum+m.text.length,0)<=24000);
});
test('bounded catalogue prioritizes selected meals and named foods',()=>{
 const many=Array.from({length:100},(_,i)=>({...foods[0],id:'food-'+i,name:'Продукт '+i}));
 const selected=selectChatFoods([...many,...foods],'Хочу кунжут',['food-99'],3);
 assert.deepEqual(selected.map(f=>f.id),['food-99','sesame','food-0']);
});
test('chat recipes reuse ingredient validation and sources come only from supplied evidence',()=>{
 const result=validateRecipeChatReply({reply:'Можно заменить завтрак.',sources:['https://magnit.ru/known','https://evil.example/unknown'],recipes:[recipe,{...recipe,ingredients:[{foodId:'invented',grams:100}]}]},foods,[{url:'https://magnit.ru/known',label:'Проверенный товар'}]);
 assert.equal(result.recipes.length,1);assert.equal(result.rejected,1);
 assert.deepEqual(result.sources,[{url:'https://magnit.ru/known',label:'Проверенный товар'}]);
 assert.equal('price' in result.recipes[0],false);
});
test('chat enforces exact requested model reasoning and structured response at provider boundary',()=>{
 const config=recipeChatGenerationConfig(['oats']);
 assert.equal(config.thinkingConfig.thinkingLevel,'high');
 assert.equal(config.responseFormat.text.mimeType,'APPLICATION_JSON');
 assert.throws(()=>validateRecipeChatReply({reply:'',recipes:[],sources:[]},foods,[]));
 assert.throws(()=>validateRecipeChatReply({reply:'x',recipes:Array(4).fill(recipe),sources:[]},foods,[]));
});
test('known-source provenance cannot make unsafe or private addresses clickable',()=>{
 const urls=['javascript:alert(1)','http://magnit.ru/product','https://localhost/product','https://127.0.0.1/product','https://user:password@magnit.ru/product','https://magnit.ru:8443/product','https://magnit.ru/product'];
 const result=validateRecipeChatReply({reply:'Проверенные данные.',sources:urls,recipes:[]},foods,urls.map(url=>({url,label:'Товар'})));
 assert.deepEqual(result.sources,[{url:'https://magnit.ru/product',label:'Товар'}]);
});
