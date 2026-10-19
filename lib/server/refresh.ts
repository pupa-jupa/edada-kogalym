import { collectPrices } from './providers';
import { acquireLease, releaseLease, readState, mutateState } from './state';
import {collectCatalog,directCatalog} from './catalog-fetch';
import {listingToOffer,mergeListings,reconcileCatalogOffers,selectCatalogRefresh} from '../catalog-sync';
import {needsScheduledRefresh} from '../schedule';
import {catalogDiscoveryDue} from '../maintenance';
import {reconcileEnrichedOffers} from '../enrichment';
export async function refreshPrices(owner:string,scheduled=false,mode:'known'|'discover'='known') {
  const lease=`refresh:${owner}`;
  if(!await acquireLease(lease,240))throw new Error('Обновление уже выполняется. Подождите несколько минут.');
  try {
    const state=await readState(owner);
    if(scheduled&&mode==='known') {
      if(!needsScheduledRefresh(state.cadence,state.lastScheduled))return {skipped:true,message:'Пока не требуется обновление'};
    }
    const sources=state.sources.filter(s=>s.enabled).filter(s=>!scheduled||mode!=='discover'||catalogDiscoveryDue(s)).slice(0,12);
    if(!sources.length)return {skipped:true,message:'Добавьте и включите источник цен'};
    let imported=0;
    const jobs=sources.map(source=>async()=>{
      const attempted=new Date().toISOString();
      try {
        if(directCatalog(source.url)){
          const batch=await collectCatalog(state,source);
          const selected=selectCatalogRefresh(state.listings??[],batch.listings,source.id,mode);
          const rows=selected.listings;const normalized=rows.flatMap(row=>{const offer=listingToOffer(row);return offer?[offer]:[];});
          await mutateState(owner,s=>{const live=s.sources.find(x=>x.id===source.id&&x.enabled&&x.url===source.url);if(!live)return;s.listings=mergeListings(s.listings??[],rows,batch.complete?source.id:'');s.offers=reconcileCatalogOffers(s.offers,rows,source.url,new Date(),batch.complete);Object.assign(live,{lastAttempt:attempted,lastSuccess:attempted,count:rows.length,...(mode==='discover'?{lastDiscoveryAttempt:attempted,nextDiscoveryAfter:new Date(Date.now()+(batch.complete?7*86400000:3600000)).toISOString(),...(batch.complete?{lastDiscovery:attempted}:{}),discovered:selected.discovered}:{}),error:batch.warning,pageCount:batch.pageCount,coverage:batch.complete?'observed-pages':'partial'});});
          imported+=normalized.length;return {source:source.label,count:rows.length,discovered:selected.discovered,normalized:normalized.length,transport:batch.transport,pageCount:batch.pageCount,complete:batch.complete,error:batch.warning};
        }
        if(mode==='known')throw new Error('Для обновления сохранённых карточек этого источника нужен прямой адаптер. Поиск новых карточек запускается отдельно.');
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
          Object.assign(live,{lastAttempt:attempted,lastSuccess:attempted,count:snapshot.listings.length,lastDiscovery:attempted,lastDiscoveryAttempt:attempted,nextDiscoveryAfter:new Date(Date.now()+7*86400000).toISOString(),error:snapshot.listings.length?undefined:'Карточки не найдены. Проверьте выбор магазина и структуру страницы.'});
        });
        imported+=sourceImported;
        return {source:source.label,count:rows.length};
      }catch(error) {
        const message=error instanceof Error?error.message:'Ошибка получения источника';
        await mutateState(owner,s=>{const live=s.sources.find(x=>x.id===source.id);if(live)Object.assign(live,{lastAttempt:attempted,error:message,...(mode==='discover'?{lastDiscoveryAttempt:attempted,nextDiscoveryAfter:new Date(Date.now()+86400000).toISOString()}:{} )});});
        return {source:source.label,count:0,error:message};
      }
    });
    const results:Awaited<ReturnType<(typeof jobs)[number]>>[]=[];let next=0;
    await Promise.all(Array.from({length:Math.min(2,jobs.length)},async()=>{while(next<jobs.length){const index=next++;results[index]=await jobs[index]();}}));
    const errors=results.filter(r=>'error' in r&&r.error).length;
    const discovered=results.reduce((sum,r)=>sum+('discovered' in r?Number(r.discovered):0),0);
    const message=`${mode==='discover'?'Поиск новых товаров':'Обновление известных товаров'}. Новых карточек: ${discovered}. Обработано предложений: ${imported}. Источников проверено: ${sources.length}. Ошибок: ${errors}. Найденные карточки сохранены отдельно от цен для меню.`;
    await mutateState(owner,s=>{s.offers=reconcileEnrichedOffers(s.offers,s.listings??[],s.enrichment??[]);s.refreshMessage=message;if(scheduled&&mode==='known')s.lastScheduled=new Date().toISOString();});
    return {mode,imported,discovered,results,message};
  }finally{await releaseLease(lease);}
}
