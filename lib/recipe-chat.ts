import {z} from 'zod';
import type {Food,Recipe} from './domain.ts';
import type {SavedRecipe} from './recipe-library.ts';
import {generationSchema,validateGeneratedBatch} from './recipe-generation.ts';
import {recipeUsageDay} from './recipe-automation.ts';
import {inputSchema,validateSourceUrl} from './validation.ts';

export const RECIPE_CHAT_MODEL='gemini-3.5-flash-lite';
export type RecipeChatSource={url:string;label:string};
export type RecipeChatMessage={id:string;role:'user'|'assistant';text:string;createdAt:string;sources?:RecipeChatSource[];recipeIds?:string[]};
export type RecipeChatState={messages:RecipeChatMessage[];day?:string;usedCalls?:number;dailyLimit?:number;inputTokens?:number;outputTokens?:number;thinkingTokens?:number;totalTokens?:number;lastError?:string};
export type RecipeChatView={messages:RecipeChatMessage[];dailyUsed:number;dailyLimit:number;model:string;reasoning:'high';inputTokens:number;outputTokens:number;thinkingTokens:number;totalTokens:number;error?:string;busy?:boolean;newRecipes?:SavedRecipe[]};
const request=z.union([z.object({reset:z.literal(true)}).strict(),z.object({message:z.string().trim().min(1).max(2000),planId:z.string().trim().min(1).max(100).optional(),input:inputSchema.optional()}).strict()]);
export function parseRecipeChatRequest(raw:unknown){return request.parse(raw);}
export function recipeChatQuota(current:Partial<RecipeChatState>={},now=new Date()){
 const limit=Number.isInteger(current.dailyLimit)&&current.dailyLimit!>0?Math.min(current.dailyLimit!,96):20;
 return {dailyUsed:current.day===recipeUsageDay(now)?Math.max(0,current.usedCalls??0):0,dailyLimit:limit};
}
export function reserveRecipeChatCall(current:RecipeChatState={messages:[]},now=new Date()):RecipeChatState{
 const quota=recipeChatQuota(current,now);
 if(quota.dailyUsed>=quota.dailyLimit)throw new Error('Дневной лимит диалога использован. Продолжить можно завтра по времени Когалыма.');
 return {...current,day:recipeUsageDay(now),usedCalls:quota.dailyUsed+1,dailyLimit:quota.dailyLimit,lastError:undefined};
}
export function capRecipeChatMessages(messages:RecipeChatMessage[]):RecipeChatMessage[]{
 const recent=messages.slice(-24);let length=recent.reduce((sum,message)=>sum+message.text.length,0);
 while(recent.length&&length>24000){length-=recent.shift()!.text.length;}
 while(recent[0]?.role==='assistant')recent.shift();
 return recent;
}
const normalize=(text:string)=>text.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е');
/** Selection is bounded, with current meals and explicit product names first. */
export function selectChatFoods(foods:Food[],message:string,selectedIds:string[]=[],limit=60):Food[]{
 const terms=normalize(message).match(/[\p{L}\p{N}]{3,}/gu)??[],selected=new Set(selectedIds);
 return foods.map((food,index)=>({food,index,score:selected.has(food.id)?1000:terms.reduce((score,term)=>score+(normalize(food.name).includes(term)?1:0),0)}))
  .sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limit).map(row=>row.food);
}
export function recipeChatGenerationConfig(foodIds:string[]){
 const generated=generationSchema(foodIds);
 const schema={type:'object',properties:{reply:{type:'string'},sources:{type:'array',maxItems:8,items:{type:'string'}},recipes:{...generated.properties.recipes,maxItems:3}},required:['reply','sources','recipes']};
 // Google documents high as the greatest supported level for this exact model.
 return {responseFormat:{text:{mimeType:'APPLICATION_JSON',schema}},thinkingConfig:{thinkingLevel:'high'},maxOutputTokens:10000};
}
export function validateRecipeChatReply(raw:unknown,foods:Food[],knownSources:RecipeChatSource[]):{reply:string;sources:RecipeChatSource[];recipes:Recipe[];rejected:number}{
 const body=z.object({reply:z.string().trim().min(1).max(6000),sources:z.array(z.string().max(2000)).max(8).default([]),recipes:z.array(z.unknown()).max(3).default([])}).parse(raw);
 const batch=validateGeneratedBatch({recipes:body.recipes,unusableTargets:[]},foods,foods.map(food=>food.id));
 const allowed=new Map(knownSources.filter(source=>{try{validateSourceUrl(source.url);return true;}catch{return false;}}).map(source=>[source.url,source]));
 return {reply:body.reply,sources:[...new Set(body.sources)].flatMap(url=>allowed.has(url)?[allowed.get(url)!]:[]),recipes:batch.recipes,rejected:batch.rejected};
}
