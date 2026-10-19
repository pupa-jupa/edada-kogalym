import type {GenerationAttempt} from './recipe-library.ts';
export type RecipeGenerationState={enabled?:boolean;dailyLimit?:number;day?:string;usedCalls?:number;attempts?:GenerationAttempt[];message?:string;lastRun?:string;lastError?:string;model?:string;inputTokens?:number;outputTokens?:number;thinkingTokens?:number;totalTokens?:number};
export function recipeUsageDay(now=new Date()):string{return new Date(now.getTime()+5*3600000).toISOString().slice(0,10);}
export function reserveRecipeCall(current:RecipeGenerationState={},now=new Date()):RecipeGenerationState{
 if(current.enabled===false)throw new Error('Автоматическое пополнение приостановлено');
 const day=recipeUsageDay(now),used=current.day===day?current.usedCalls??0:0,limit=current.dailyLimit??40;
 if(used>=limit)throw new Error('Лимит генерации на сегодня достигнут. Сохранённые рецепты доступны.');
 return {...current,day,usedCalls:used+1,dailyLimit:limit,lastRun:now.toISOString()};
}
