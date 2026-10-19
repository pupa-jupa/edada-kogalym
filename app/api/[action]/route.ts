import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getChatGPTUser } from '../../chatgpt-auth';
import { readState, mutateState, database, acquireLease, releaseLease } from '../../../lib/server/state';
import { FOODS, STORES, RECIPES } from '../../../lib/catalog';
import { inputSchema, validateOffer, validateSourceUrl,storeIdSchema } from '../../../lib/validation';
import { seal } from '../../../lib/secrets';
import { apiKey, listModels } from '../../../lib/server/providers';
import { refreshPrices } from '../../../lib/server/refresh';
import { optimizeMenu } from '../../../lib/optimizer';
import type { Source } from '../../../lib/domain';
import {validateListing} from '../../../lib/listing-validation';
import {mergeListings,mergeCatalogOffers} from '../../../lib/catalog-sync';
import {validBarcode,parseNutrition} from '../../../lib/nutrition';
import {allFoods} from '../../../lib/menu-recipes';
import {enrichmentKey,matchProduct,isExcludedProduct,preservePreparation,type ProductCandidate} from '../../../lib/product-enrichment';
import {resolveProductPreparation} from '../../../lib/product-preparation';
import {enrichmentSummary,reconcileEnrichedOffers} from '../../../lib/enrichment';
import {enrichBatch} from '../../../lib/server/enrichment';
import {macrosSchema} from '../../../lib/validation';
import {enrichRetailerIndex,seedRetailerReferences} from '../../../lib/server/retailer-enrichment';
import {bulkProgress} from '../../../lib/bulk-enrichment';
import {fillRecipeLibrary,recipeLibraryView,recipesForPlan,probeRecipeProvider} from '../../../lib/server/recipe-library';
import {applyProductReviewWithOffers,productReviewView,reviewCommandSchema} from '../../../lib/product-review';
export const dynamic='force-dynamic';
type Context={params:Promise<{action:string}>};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const candidateSchema=z.object({productName:z.string().min(3).max(300),brand:z.string().max(200).optional(),barcode:z.string().refine(validBarcode).optional(),packGrams:z.number().positive().max(20000).optional(),quantityText:z.string().max(400).optional(),macros:macrosSchema,sourceUrl:z.string().url().max(2000),nutritionSourceUrl:z.string().url().max(2000).optional(),quantitySourceUrl:z.string().url().max(2000).optional(),observedAt:z.string().datetime({offset:true}),estimated:z.boolean().optional(),evidence:z.string().max(2000).optional()});
async function route(request:Request,ctx:Context) {
  try {
    const {action}=await ctx.params;
    const isPost=request.method==='POST';
    if(Number(request.headers.get('content-length')??0)>256000)return json({error:'Слишком большой запрос. Максимум 250 КБ.'},413);
    let body:any={};
    if(isPost){const text=await request.text();if(text.length>256000)return json({error:'Слишком большой запрос'},413);body=text?JSON.parse(text):{};}
    if((action==='catalog-service'||action==='enrichment-service'||action==='recipe-service')&&isPost){
      // The same owner-private dispatch boundary as refresh-service. No visitor credentials or secrets are returned.
      if(env.PRIVATE_REFRESH_ENABLED!=='true'||request.headers.get('origin'))return json({error:'Сервисный endpoint недоступен'},403);
      const owners=await database().prepare('SELECT id FROM user_state LIMIT 2').all<{id:string}>();
      if(owners.results.length!==1)return json({error:'Для импорта требуется ровно одно личное пространство владельца'},409);
      const owner=owners.results[0].id;
      if(action==='recipe-service'){
        if(body.operation==='probe')return json(await probeRecipeProvider(owner,z.enum(['text','json','schema','legacy','large']).parse(body.mode)));
        if(body.operation==='fill')return json(await fillRecipeLibrary(owner,{manual:true,retryErrors:body.retryErrors===true}));
        const s=await readState(owner);
        if(body.operation==='models')return json({models:await listModels(s),selectedModel:s.recipeModel});
        if(body.operation==='verify-menu'){const input=inputSchema.parse(body.input);return json({result:optimizeMenu(input,s.offers,recipesForPlan(s,input))});}
        if(body.operation==='inspect')return json({configured:!!await apiKey(s,'gemini'),...recipeLibraryView(s),recipes:(s.recipes??[]).map(r=>({recipe:r.recipe,model:r.model,createdAt:r.createdAt})),attempts:s.recipeGeneration?.attempts??[]});
        return json({error:'Неизвестная операция библиотеки'},400);
      }
      if(action==='enrichment-service'){
        if(body.operation==='resolve-preparation'){
          const entries=z.array(z.object({foodId:z.string().min(3).max(100),expectedIdentity:z.string().min(1).max(100),preparation:z.object({kind:z.string().min(1).max(40),useWholeContents:z.boolean().optional(),sourceUrl:z.string().url().max(2000),evidence:z.string().min(20).max(2000),observedAt:z.string().datetime({offset:true})})})).min(1).max(50).parse(body.entries);
          let applied:string[]=[],rejected:Array<{foodId:string;reason:string}>=[];
          const s=await mutateState(owner,state=>{
            const result=resolveProductPreparation(state.listings??[],state.enrichment??[],entries);
            state.enrichment=result.records;applied=result.applied;rejected=result.rejected;
            state.offers=reconcileEnrichedOffers(state.offers,state.listings??[],state.enrichment);
          });
          return json({applied,rejected,recipeLibrary:recipeLibraryView(s)});
        }
        if(body.scheduleInstalled===true)await database().prepare('INSERT INTO refresh_leases (id,expires_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at').bind('enrichment:schedule',8640000000000000).run();
        if(body.operation==='pending'){
          const s=await readState(owner);if(s.enrichmentEnabled===false)return json({enabled:false,products:[]});
          const records=new Map((s.enrichment??[]).map(r=>[r.key,r]));const seen=new Set<string>();
          const products=(s.listings??[]).filter(row=>{
            const key=enrichmentKey(row);if(seen.has(key)||!row.price||!['listed','in-stock'].includes(row.availability)||isExcludedProduct(row.name))return false;
            const r=records.get(key);if(r?.userExcluded)return false;if(r?.status==='matched'&&Date.parse(r.retryAt)>Date.now())return false;
            if(r&&r.provider!=='off'&&r.provider!=='retailer-index'&&Date.parse(r.retryAt)>Date.now())return false;seen.add(key);return true;
          }).slice(0,z.number().int().min(1).max(20).parse(body.limit??6)).map(row=>({key:enrichmentKey(row),name:row.name,packGrams:row.packGrams,packText:row.packText,priceUnit:row.priceUnit,sourceUrl:row.sourceUrl}));
          return json({enabled:true,products});
        }
        if(body.operation==='run'){const enrichment=await enrichBatch(owner,typeof body.limit==='number'?body.limit:6);const recipes=await fillRecipeLibrary(owner);return json({...enrichment,recipeLibrary:recipes});}
        if(body.operation==='bulk-run')return json(await enrichRetailerIndex(owner,typeof body.limit==='number'?body.limit:100));
        if(body.operation==='reference-cache'){
          const entries=z.array(z.object({sourceUrl:z.string().url().max(2000),observedAt:z.string().datetime({offset:true}),candidate:candidateSchema.nullable()})).max(100).parse(body.entries);
          return json(await seedRetailerReferences(entries));
        }
        if(body.operation==='public-snapshot'){
          const s=await readState(owner);return json({listings:s.listings??[],offers:s.offers,foods:allFoods(s.enrichment??[],s.listings??[]),records:s.enrichment??[],bulk:bulkProgress(s.retailerBulk),summary:enrichmentSummary(s.listings??[],s.enrichment??[],s.offers)});
        }
        if(body.operation==='import'){
          const candidates=z.array(candidateSchema).max(100).parse(body.candidates??[]);
          const checkedKeys=z.array(z.string().max(40)).max(20).parse(body.checkedKeys??[]);if(!candidates.length&&!checkedKeys.length)throw new Error('Пустая партия характеристик');
          for(const c of candidates){validateSourceUrl(c.sourceUrl);if(c.nutritionSourceUrl)validateSourceUrl(c.nutritionSourceUrl);if(c.quantitySourceUrl)validateSourceUrl(c.quantitySourceUrl);if(Date.parse(c.observedAt)>Date.now()+60000)throw new Error('Дата характеристик в будущем');}
          await mutateState(owner,s=>{
            const records=new Map((s.enrichment??[]).map(r=>[r.key,r]));
            for(const row of s.listings??[]){const key=enrichmentKey(row);const previous=records.get(key);if(previous?.userExcluded||previous?.candidate?.userVerified)continue;const result=matchProduct(row,candidates as ProductCandidate[]);if(result.status==='not-found'&&!checkedKeys.includes(key))continue;if(result.status!=='matched'&&previous?.status==='matched')continue;records.set(key,preservePreparation(row,previous,{key,listingName:row.name,...result,checkedAt:new Date().toISOString(),retryAt:new Date(Date.now()+(result.status==='matched'?30:7)*86400000).toISOString(),attempts:(previous?.attempts??0)+1,provider:'web'}));}
            s.enrichment=[...records.values()];s.offers=reconcileEnrichedOffers(s.offers,s.listings??[],s.enrichment);
          });
        }else if(body.operation!=='inspect')return json({error:'Неизвестная операция обогащения'},400);
        const s=await readState(owner);return json({summary:enrichmentSummary(s.listings??[],s.enrichment??[],s.offers),firecrawlConfigured:!!await apiKey(s,'firecrawl'),enabled:s.enrichmentEnabled!==false,records:(s.enrichment??[]).map(r=>({key:r.key,name:r.listingName,status:r.status,reason:r.reason,checkedAt:r.checkedAt,retryAt:r.retryAt}))});
      }
      if(body.operation==='export'){
        const s=await readState(owner);const offset=z.number().int().min(0).max(5000).parse(body.offset??0);const limit=z.number().int().min(1).max(100).parse(body.limit??75);const listings=(s.listings??[]).slice(offset,offset+limit);return json({listings,total:s.listings?.length??0,nextOffset:offset+listings.length<(s.listings?.length??0)?offset+listings.length:null});
      }
      if(body.operation==='upsert'){
        const listings=z.array(z.unknown()).max(150).parse(body.listings??[]).map(r=>validateListing(r));
        const current=await readState(owner);const registry=allFoods(current.enrichment??[],current.listings??[]);
        const offers=z.array(z.unknown()).max(100).parse(body.offers??[]).map(r=>validateOffer(r,registry.map(f=>f.id)));
        const sources=z.array(z.object({id:z.string().min(1).max(120),storeId:storeIdSchema,url:z.string().max(2000),label:z.string().min(1).max(100),enabled:z.boolean()})).max(12).parse(body.sources??[]).map(s=>({...s,url:validateSourceUrl(s.url)}));
        await mutateState(owner,s=>{
          s.listings=mergeListings(s.listings??[],listings,'');s.offers=mergeCatalogOffers(s.offers,offers);
          for(const source of sources){const old=s.sources.find(x=>x.id===source.id||x.url===source.url);if(old)Object.assign(old,source);else if(s.sources.length<12)s.sources.push(source);}
          for(const source of s.sources){const count=(s.listings??[]).filter(l=>l.sourceId===source.id).length;if(count)Object.assign(source,{count,lastSuccess:new Date().toISOString(),lastAttempt:new Date().toISOString()});}
          if(body.cadence==='daily'||body.cadence==='weekly')s.cadence=body.cadence;
          s.offers=reconcileEnrichedOffers(s.offers,s.listings??[],s.enrichment??[]);
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
        const prices=await refreshPrices(row.id,body.force!==true);const enrichment=await enrichBatch(row.id,6);const recipes=await fillRecipeLibrary(row.id);results.push({...prices,enrichment,recipeLibrary:recipes});
      }
      return json({ok:true,results});
    }
    const user=await getChatGPTUser();
    if(!user)return json({error:'Войдите через ChatGPT, чтобы сохранить ваши данные'},401);
    if(isPost){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Недопустимый источник запроса'},403);}
    const owner=user.userId;
    const state=await readState(owner);
    const registry=allFoods(state.enrichment??[],state.listings??[]);
    if(action==='recipes'&&isPost){
      if(body.operation==='settings'){const enabled=z.boolean().parse(body.enabled);const limit=body.dailyLimit===undefined?undefined:z.number().int().min(1).max(96).parse(body.dailyLimit);await mutateState(owner,s=>{s.recipeGeneration={...s.recipeGeneration,enabled,...(limit?{dailyLimit:limit}:{})};});return json({message:enabled?'Автоматическая генерация включена':'Автоматическая генерация приостановлена'});}
      if(body.operation==='fill')return json(await fillRecipeLibrary(owner,{manual:true}));
      return json({error:'Неизвестная операция библиотеки'},400);
    }
    if(action==='review'&&isPost){const command=reviewCommandSchema.parse(body);let message='';await mutateState(owner,s=>{const result=applyProductReviewWithOffers(s.listings??[],s.enrichment??[],s.offers,s.reviewLedger,command);s.enrichment=result.enrichment;s.reviewLedger=result.ledger;s.offers=result.offers;if(s.recipeGeneration?.attempts)s.recipeGeneration.attempts=s.recipeGeneration.attempts.filter(a=>a.foodId!=='e-'+command.key);message=result.message;});return json({message});}
    if(action==='enrichment'&&isPost){
      if(body.operation==='settings'){await mutateState(owner,s=>{s.enrichmentEnabled=z.boolean().parse(body.enabled);});return json({message:body.enabled?'Автоматическое обогащение включено':'Автоматическое обогащение выключено'});}
      return json(await enrichBatch(owner));
    }
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
      const nutritionSchedule=await database().prepare('SELECT expires_at FROM refresh_leases WHERE id=?').bind('enrichment:schedule').first();
      return json({foods:registry,stores:STORES,recipes:recipesForPlan(state,state.input??{budget:1200,proteinMin:120,proteinTolerance:10,meals:3,maxMinutes:40,storeIds:STORES.map(s=>s.id),excludedFoodIds:[],demo:false}),recipeLibrary:recipeLibraryView(state),review:productReviewView(state.listings??[],state.enrichment??[],state.offers,state.reviewLedger,new Date(),state.recipeGeneration?.attempts??[]),offers:state.offers,listings:state.listings??[],sources:state.sources,history:state.history,input:state.input,refreshMessage:state.refreshMessage,enrichment:{summary:enrichmentSummary(state.listings??[],state.enrichment??[],state.offers),enabled:state.enrichmentEnabled!==false,cloudAutomationReady:!!nutritionSchedule,message:state.enrichmentMessage,items:(state.enrichment??[]).map(r=>({key:r.key,status:r.status,reason:r.reason,checkedAt:r.checkedAt,retryAt:r.retryAt,sourceUrl:r.candidate?.nutritionSourceUrl??r.candidate?.sourceUrl,quantitySourceUrl:r.candidate?.quantitySourceUrl}))},settings:{recipeModel:state.recipeModel,extractionModel:state.extractionModel,cadence:state.cadence,geminiConfigured:!!await apiKey(state,'gemini'),firecrawlConfigured:!!await apiKey(state,'firecrawl'),automationReady:!!scheduleInstalled}});
    }
    if(action==='settings'&&isPost) {
      const settings=z.object({recipeModel:z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),extractionModel:z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),cadence:z.enum(['daily','weekly','manual']),geminiKey:z.string().max(300).optional(),firecrawlKey:z.string().max(300).optional(),clearGemini:z.boolean().optional(),clearFirecrawl:z.boolean().optional()}).parse(body);
      const encryptedGemini=settings.geminiKey?await seal(settings.geminiKey.trim(),env.APP_ENCRYPTION_KEY??''):undefined;
      const encryptedFirecrawl=settings.firecrawlKey?await seal(settings.firecrawlKey.trim(),env.APP_ENCRYPTION_KEY??''):undefined;
      await mutateState(owner,s=>{s.recipeModel=settings.recipeModel;s.extractionModel=settings.extractionModel;s.cadence=settings.cadence;if(encryptedGemini)s.gemini=encryptedGemini;if(encryptedFirecrawl){s.firecrawl=encryptedFirecrawl;s.enrichment=(s.enrichment??[]).filter(r=>r.status==='matched'||r.status==='ambiguous');}if(settings.clearGemini)delete s.gemini;if(settings.clearFirecrawl)delete s.firecrawl;});
      return json({ok:true,message:'Настройки сохранены. Ключи зашифрованы на сервере.'});
    }
    if(action==='models'&&isPost)return json({models:await listModels(state)});
    if(action==='offers'&&isPost) {
      if(body.operation==='delete'){const id=z.string().max(120).parse(body.id);await mutateState(owner,s=>{s.offers=s.offers.filter(o=>o.id!==id);});return json({ok:true});}
      const rows=z.array(z.unknown()).min(1).max(100).parse(body.offers);
      const parsed=rows.map((r:any)=>validateOffer({...r,id:r.id??crypto.randomUUID(),demo:r.demo??false},registry.map(f=>f.id)));
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
      const generation=state.recipeGeneration?.enabled!==false||body.useAI===true?await fillRecipeLibrary(owner,{input,force:body.useAI===true,manual:body.useAI===true}):undefined;
      const current=await readState(owner);const result=optimizeMenu(input,current.offers,recipesForPlan(current,input));
      if(generation&&'error' in generation&&generation.error)result.warnings.push('Gemini: '+generation.error+'. Использованы сохранённые рецепты.');
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
