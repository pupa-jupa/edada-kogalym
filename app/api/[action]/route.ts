import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getChatGPTUser } from '../../chatgpt-auth';
import { readState, mutateState, database, acquireLease, releaseLease } from '../../../lib/server/state';
import { FOODS, STORES, RECIPES } from '../../../lib/catalog';
import { inputSchema, validateOffer, validateSourceUrl,storeIdSchema } from '../../../lib/validation';
import { seal } from '../../../lib/secrets';
import { apiKey, generateRecipes, listModels } from '../../../lib/server/providers';
import { refreshPrices } from '../../../lib/server/refresh';
import { optimizeMenu } from '../../../lib/optimizer';
import type { Source } from '../../../lib/domain';
import {validateListing} from '../../../lib/listing-validation';
import {mergeListings,mergeCatalogOffers} from '../../../lib/catalog-sync';
import {validBarcode,parseNutrition} from '../../../lib/nutrition';
export const dynamic='force-dynamic';
type Context={params:Promise<{action:string}>};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function route(request:Request,ctx:Context) {
  try {
    const {action}=await ctx.params;
    const isPost=request.method==='POST';
    if(Number(request.headers.get('content-length')??0)>256000)return json({error:'Слишком большой запрос. Максимум 250 КБ.'},413);
    let body:any={};
    if(isPost){const text=await request.text();if(text.length>256000)return json({error:'Слишком большой запрос'},413);body=text?JSON.parse(text):{};}
    if(action==='catalog-service'&&isPost){
      // The same owner-private dispatch boundary as refresh-service. No visitor credentials or secrets are returned.
      if(env.PRIVATE_REFRESH_ENABLED!=='true'||request.headers.get('origin'))return json({error:'Сервисный endpoint недоступен'},403);
      const owners=await database().prepare('SELECT id FROM user_state LIMIT 2').all<{id:string}>();
      if(owners.results.length!==1)return json({error:'Для импорта требуется ровно одно личное пространство владельца'},409);
      const owner=owners.results[0].id;
      if(body.operation==='upsert'){
        const listings=z.array(z.unknown()).max(150).parse(body.listings??[]).map(r=>validateListing(r));
        const offers=z.array(z.unknown()).max(100).parse(body.offers??[]).map(r=>validateOffer(r,FOODS.map(f=>f.id)));
        const sources=z.array(z.object({id:z.string().min(1).max(120),storeId:storeIdSchema,url:z.string().max(2000),label:z.string().min(1).max(100),enabled:z.boolean()})).max(12).parse(body.sources??[]).map(s=>({...s,url:validateSourceUrl(s.url)}));
        await mutateState(owner,s=>{
          s.listings=mergeListings(s.listings??[],listings,'');s.offers=mergeCatalogOffers(s.offers,offers);
          for(const source of sources){const old=s.sources.find(x=>x.id===source.id||x.url===source.url);if(old)Object.assign(old,source);else if(s.sources.length<12)s.sources.push(source);}
          for(const source of s.sources){const count=(s.listings??[]).filter(l=>l.sourceId===source.id).length;if(count)Object.assign(source,{count,lastSuccess:new Date().toISOString(),lastAttempt:new Date().toISOString()});}
          if(body.cadence==='daily'||body.cadence==='weekly')s.cadence=body.cadence;
        });
      }else if(body.operation!=='inspect')return json({error:'Неизвестная операция каталога'},400);
      const result=await readState(owner);return json({ok:true,offers:result.offers.length,activeOffers:result.offers.filter(o=>o.status==='confirmed'&&Date.parse(o.validUntil)>Date.now()&&(!o.validFrom||Date.parse(o.validFrom)<=Date.now())).length,listings:result.listings?.length??0,syntheticOffers:result.offers.filter(o=>o.demo).length,syntheticPlans:result.history.filter(p=>p.input.demo).length,cadence:result.cadence,lastScheduled:result.lastScheduled,sources:result.sources.map(s=>({id:s.id,storeId:s.storeId,url:s.url,count:s.count,lastSuccess:s.lastSuccess,error:s.error,enabled:s.enabled}))});
    }
    if(action==='refresh-service'&&isPost) {
      // Dispatch enforces owner-private service access before reaching this Worker.
      if(env.PRIVATE_REFRESH_ENABLED!=='true')return json({error:'Сервисное обновление отключено'},403);
      if(request.headers.get('origin'))return json({error:'Сервисный endpoint недоступен из браузера'},403);
      if(body.scheduleInstalled===true)await database().prepare('INSERT INTO refresh_leases (id,expires_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at').bind('schedule:installed',8640000000000000).run();
      const rows=await database().prepare('SELECT id FROM user_state LIMIT 10').all<{id:string}>();
      const results=[];
      for(const row of rows.results){
        if(body.scheduleInstalled===true)await mutateState(row.id,s=>{s.automationReady=true;});
        results.push(await refreshPrices(row.id,body.force!==true));
      }
      return json({ok:true,results});
    }
    const user=await getChatGPTUser();
    if(!user)return json({error:'Войдите через ChatGPT, чтобы сохранить ваши данные'},401);
    if(isPost){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Недопустимый источник запроса'},403);}
    const owner=user.userId;
    const state=await readState(owner);
    if(action==='nutrition'&&isPost){
      const code=z.string().max(14).parse(body.barcode);if(!validBarcode(code))return json({error:'Проверьте цифры и контрольную сумму штрихкода'},400);
      const cached=state.nutritionCache?.find(x=>x.code===code&&Date.now()-Date.parse(x.observedAt)<7*86400000);if(cached)return json(cached);
      if(!await acquireLease('nutrition:openfoodfacts',5))return json({error:'База ограничивает частоту запросов. Повторите через 5 секунд.'},429);
      const url=`https://world.openfoodfacts.org/api/v3.6/product/${code}.json?fields=code,product_name,brands,quantity,nutrition,nutriments`;
      const response=await fetch(url,{headers:{'User-Agent':'Edada/0.2 (+https://eda-da-kogalym.social-grape-1472.chatgpt.site)'},signal:AbortSignal.timeout(15000),redirect:'manual'});
      if(!response.ok)return json({error:`Open Food Facts недоступен (HTTP ${response.status}). Прежние КБЖУ сохранены.`},502);
      const candidate=parseNutrition(await response.json(),code);
      await mutateState(owner,s=>{s.nutritionCache=[candidate,...(s.nutritionCache??[]).filter(x=>x.code!==code)].slice(0,50);});return json(candidate);
    }
    if(action==='data'&&!isPost){
      const scheduleInstalled=await database().prepare('SELECT expires_at FROM refresh_leases WHERE id=?').bind('schedule:installed').first();
      return json({foods:FOODS,stores:STORES,recipes:RECIPES,offers:state.offers,listings:state.listings??[],sources:state.sources,history:state.history,input:state.input,refreshMessage:state.refreshMessage,settings:{recipeModel:state.recipeModel,extractionModel:state.extractionModel,cadence:state.cadence,geminiConfigured:!!await apiKey(state,'gemini'),firecrawlConfigured:!!await apiKey(state,'firecrawl'),automationReady:!!scheduleInstalled}});
    }
    if(action==='settings'&&isPost) {
      const settings=z.object({recipeModel:z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),extractionModel:z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),cadence:z.enum(['daily','weekly','manual']),geminiKey:z.string().max(300).optional(),firecrawlKey:z.string().max(300).optional(),clearGemini:z.boolean().optional(),clearFirecrawl:z.boolean().optional()}).parse(body);
      const encryptedGemini=settings.geminiKey?await seal(settings.geminiKey.trim(),env.APP_ENCRYPTION_KEY??''):undefined;
      const encryptedFirecrawl=settings.firecrawlKey?await seal(settings.firecrawlKey.trim(),env.APP_ENCRYPTION_KEY??''):undefined;
      await mutateState(owner,s=>{s.recipeModel=settings.recipeModel;s.extractionModel=settings.extractionModel;s.cadence=settings.cadence;if(encryptedGemini)s.gemini=encryptedGemini;if(encryptedFirecrawl)s.firecrawl=encryptedFirecrawl;if(settings.clearGemini)delete s.gemini;if(settings.clearFirecrawl)delete s.firecrawl;});
      return json({ok:true,message:'Настройки сохранены. Ключи зашифрованы на сервере.'});
    }
    if(action==='models'&&isPost)return json({models:await listModels(state)});
    if(action==='offers'&&isPost) {
      if(body.operation==='delete'){const id=z.string().max(120).parse(body.id);await mutateState(owner,s=>{s.offers=s.offers.filter(o=>o.id!==id);});return json({ok:true});}
      const rows=z.array(z.unknown()).min(1).max(100).parse(body.offers);
      const parsed=rows.map((r:any)=>validateOffer({...r,id:r.id??crypto.randomUUID(),demo:r.demo??false},FOODS.map(f=>f.id)));
      await mutateState(owner,s=>{for(const o of parsed){const index=s.offers.findIndex(x=>x.id===o.id);if(index<0)s.offers.push(o);else s.offers[index]=o;}});
      return json({ok:true,count:parsed.length});
    }
    if(action==='sources'&&isPost) {
      if(body.operation==='delete'){const id=z.string().max(120).parse(body.id);await mutateState(owner,s=>{s.sources=s.sources.filter(x=>x.id!==id);});return json({ok:true});}
      const source=z.object({id:z.string().max(120).optional(),storeId:storeIdSchema,url:z.string().max(2000),label:z.string().min(1).max(100),enabled:z.boolean()}).parse(body);
      source.url=validateSourceUrl(source.url);
      await mutateState(owner,s=>{const old=s.sources.find(x=>x.id===source.id);if(old)Object.assign(old,source);else {if(s.sources.length>=12)throw new Error('Максимум 12 источников');s.sources.push({...source,id:crypto.randomUUID()} as Source);}});
      return json({ok:true});
    }
    if(action==='refresh'&&isPost)return json(await refreshPrices(owner));
    if(action==='plan'&&isPost) {
      const input=inputSchema.parse(body.input);
      const offers=state.offers;
      let recipes=RECIPES;
      if(body.useAI===true){
        const lock=`ai:${owner}`;
        if(!await acquireLease(lock,90))throw new Error('Gemini уже готовит рецепты. Дождитесь результата.');
        try {
          if(state.lastAI&&Date.now()-state.lastAI<15000)throw new Error('Подождите 15 секунд между AI-запросами');
          await mutateState(owner,s=>{s.lastAI=Date.now();});
          recipes=[...await generateRecipes(state,input,offers),...RECIPES];
        }finally{await releaseLease(lock);}
      }
      const result=optimizeMenu(input,offers,recipes);
      const saved={id:crypto.randomUUID(),createdAt:new Date().toISOString(),input,result};
      await mutateState(owner,s=>{s.input=input;s.history=[saved,...s.history].slice(0,15);});
      return json(saved);
    }
    return json({error:'Действие не найдено'},404);
  }catch(error) {
    if(error instanceof z.ZodError)return json({error:'Проверьте поля: '+error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).slice(0,3).join('; ')},400);
    if(error instanceof SyntaxError)return json({error:'Некорректный JSON. Проверьте формат импорта.'},400);
    if(error instanceof DOMException&&error.name==='TimeoutError')return json({error:'Сервис не ответил вовремя. Повторите запрос.'},504);
    return json({error:error instanceof Error?error.message:'Не удалось выполнить действие'},400);
  }
}
export const GET=route;
export const POST=route;
