import { collectPrices } from './providers';
import { acquireLease, releaseLease, readState, mutateState } from './state';
import {collectCatalog,directCatalog} from './catalog-fetch';
import {listingToOffer,mergeListings,reconcileCatalogOffers} from '../catalog-sync';
import {needsScheduledRefresh} from '../schedule';
export async function refreshPrices(owner:string,scheduled=false) {
  const lease=`refresh:${owner}`;
  if(!await acquireLease(lease,240))throw new Error('Обновление уже выполняется. Подождите несколько минут.');
  try {
    const state=await readState(owner);
    if(scheduled) {
      if(!needsScheduledRefresh(state.cadence,state.lastScheduled))return {skipped:true,message:'Пока не требуется обновление'};
    }
    const sources=state.sources.filter(s=>s.enabled).slice(0,12);
    if(!sources.length)return {skipped:true,message:'Добавьте и включите источник цен'};
    let imported=0;
    const results=await Promise.all(sources.map(async source=>{
      const attempted=new Date().toISOString();
      try {
        if(directCatalog(source.url)){
          const batch=await collectCatalog(state,source);const normalized=batch.listings.flatMap(row=>{const offer=listingToOffer(row);return offer?[offer]:[];});
          await mutateState(owner,s=>{const live=s.sources.find(x=>x.id===source.id&&x.enabled&&x.url===source.url);if(!live)return;s.listings=mergeListings(s.listings??[],batch.listings,batch.complete?source.id:'');s.offers=reconcileCatalogOffers(s.offers,batch.listings,source.url,new Date(),batch.complete);Object.assign(live,{lastAttempt:attempted,lastSuccess:attempted,count:batch.listings.length,error:batch.warning,pageCount:batch.pageCount,coverage:batch.complete?'observed-pages':'partial'});});
          imported+=normalized.length;return {source:source.label,count:batch.listings.length,normalized:normalized.length,transport:batch.transport,pageCount:batch.pageCount,complete:batch.complete,error:batch.warning};
        }
        const snapshot=await collectPrices(state,source);const rows=snapshot.offers;
        let sourceImported=0;
        await mutateState(owner,s=>{
          sourceImported=0;
          const live=s.sources.find(x=>x.id===source.id&&x.enabled&&x.url===source.url);if(!live)return;
          s.listings=mergeListings(s.listings??[],snapshot.listings,source.id);
          s.offers=s.offers.filter(o=>o.status!=='pending'||Date.parse(o.validUntil)>Date.now());
          for(const row of rows){
            const old=s.offers.findIndex(o=>o.status==='pending'&&o.sourceUrl===row.sourceUrl&&o.storeId===row.storeId&&o.foodId===row.foodId&&o.name===row.name&&o.packGrams===row.packGrams);
            if(old>=0)s.offers[old]={...row,id:s.offers[old].id};else if(s.offers.length<600)s.offers.push(row);else continue;
            sourceImported++;
          }
          Object.assign(live,{lastAttempt:attempted,lastSuccess:attempted,count:snapshot.listings.length,error:snapshot.listings.length?undefined:'Карточки не найдены. Проверьте выбор магазина и структуру страницы.'});
        });
        imported+=sourceImported;
        return {source:source.label,count:rows.length};
      }catch(error) {
        const message=error instanceof Error?error.message:'Ошибка получения источника';
        await mutateState(owner,s=>{const live=s.sources.find(x=>x.id===source.id);if(live)Object.assign(live,{lastAttempt:attempted,error:message});});
        return {source:source.label,count:0,error:message};
      }
    }));
    const errors=results.filter(r=>'error' in r&&r.error).length;
    const message=`Обработано предложений: ${imported}. Источников проверено: ${sources.length}. Ошибок: ${errors}. Найденные карточки сохранены отдельно от цен для меню.`;
    await mutateState(owner,s=>{s.refreshMessage=message;if(scheduled)s.lastScheduled=new Date().toISOString();});
    return {imported,results,message};
  }finally{await releaseLease(lease);}
}
