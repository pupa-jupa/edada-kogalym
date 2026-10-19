import {readState,mutateState,acquireLease,releaseLease} from './state';
import {apiKey} from './providers';
import {enrichmentKey} from '../product-enrichment';
import {knownRefreshQueue,applyKnownRefresh,refreshSnapshot,SOURCE_PARSER_VERSION} from '../source-refresh';
import {bindingForCandidate,refreshKnownSource,type KnownSourceResult} from '../known-product-fetch';
import {reconcileEnrichedOffers,enrichmentSummary} from '../enrichment';
import {mapWithinBudget} from '../bulk-enrichment';

/** No discovery or models here. A due binding is always checked over the network. */
export async function refreshKnownProducts(owner:string,limit=40,budgetMs=75000,options:{force?:boolean;keys?:string[]}={}){
 const lock='enrichment:'+owner;if(!await acquireLease(lock,120))return {busy:true,message:'Проверка товаров уже выполняется'};
 try{
  const state=await readState(owner);if(state.enrichmentEnabled===false)return {disabled:true,message:'Автоматическая проверка выключена'};
  const queue=knownRefreshQueue(state.listings??[],state.enrichment??[],new Date(),options.force).filter(row=>!options.keys||options.keys.includes(enrichmentKey(row))).slice(0,Math.max(1,Math.min(100,limit)));
  const records=new Map((state.enrichment??[]).map(r=>[r.key,r]));
  const deadline=Date.now()+Math.max(5000,Math.min(85000,budgetMs)),key=queue.length?await apiKey(state,'firecrawl'):undefined;
  const paused=new Set<string>();
  const results=await mapWithinBudget(queue,2,deadline-3000,async row=>{
   const record=records.get(enrichmentKey(row))!,binding=bindingForCandidate(record.candidate!)!;
   if(paused.has(new URL(binding.url).hostname))return null;
   let result:KnownSourceResult;
   if(binding.kind==='off'){
    while(!await acquireLease('nutrition:openfoodfacts',5)){
     if(Date.now()+6000>=deadline)return null;
     await new Promise(resolve=>setTimeout(resolve,1000));
    }
   }
   {
    const prior=record.sourceRefresh;
    const validators=prior?.parserVersion===SOURCE_PARSER_VERSION&&JSON.stringify(prior.binding)===JSON.stringify(binding)?prior.validators:undefined;
    result=await refreshKnownSource(binding,{deadline,validators,firecrawlKey:key});
   }
   if(result.status==='error'&&/HTTP 429/.test(result.reason))paused.add(new URL(binding.url).hostname);
   return {row,expected:refreshSnapshot(record),result};
  });
  let checked=0,changed=0,unchanged=0,errors=0,conflicts=0;
  const current=await mutateState(owner,s=>{
   checked=0;changed=0;unchanged=0;errors=0;conflicts=0;
   const liveKeys=new Set((s.listings??[]).map(enrichmentKey)),byKey=new Map((s.enrichment??[]).map(r=>[r.key,r]));
   for(const item of results){if(!item)continue;const k=enrichmentKey(item.row),old=byKey.get(k);if(!liveKeys.has(k)||!old)continue;
    const next=applyKnownRefresh(item.row,old,item.expected,item.result);if(!next)continue;byKey.set(k,next);checked++;
    if(next.sourceRefresh?.status==='current'){if(next.sourceRefresh.lastChangedAt!==old.sourceRefresh?.lastChangedAt&&next.sourceRefresh.changes[0]?.at===next.sourceRefresh.lastCheckedAt)changed++;else unchanged++;}
    else if(next.sourceRefresh?.status==='conflict')conflicts++;else errors++;
   }
   s.enrichment=[...byKey.values()];s.offers=reconcileEnrichedOffers(s.offers,s.listings??[],s.enrichment);
   s.enrichmentMessage=`Сохранённые источники: проверено ${checked}; изменилось ${changed}; без изменений ${unchanged}; требуют повтора или нового источника ${errors}; расхождений с вашими данными ${conflicts}.`;
  });
  return {mode:'known',checked,changed,unchanged,errors,conflicts,summary:enrichmentSummary(current.listings??[],current.enrichment??[],current.offers),message:current.enrichmentMessage};
 }finally{await releaseLease(lock);}
}
