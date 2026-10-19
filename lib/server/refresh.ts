import { collectPrices } from './providers';
import { acquireLease, releaseLease, readState, mutateState } from './state';
export async function refreshPrices(owner:string,scheduled=false) {
  const lease=`refresh:${owner}`;
  if(!await acquireLease(lease,240))throw new Error('Обновление уже выполняется. Подождите несколько минут.');
  try {
    const state=await readState(owner);
    if(scheduled) {
      const interval=state.cadence==='weekly'?7*86400000:86400000;
      if(state.cadence==='manual'||(state.lastScheduled&&Date.now()-Date.parse(state.lastScheduled)<interval-60000))return {skipped:true,message:'Пока не требуется обновление'};
    }
    const sources=state.sources.filter(s=>s.enabled).slice(0,3);
    if(!sources.length)return {skipped:true,message:'Добавьте и включите источник цен'};
    let imported=0;
    const results=await Promise.all(sources.map(async source=>{
      const attempted=new Date().toISOString();
      try {
        const rows=await collectPrices(state,source);
        let sourceImported=0;
        await mutateState(owner,s=>{
          sourceImported=0;
          const live=s.sources.find(x=>x.id===source.id&&x.enabled&&x.url===source.url);if(!live)return;
          s.offers=s.offers.filter(o=>o.status!=='pending'||Date.parse(o.validUntil)>Date.now());
          for(const row of rows){
            const old=s.offers.findIndex(o=>o.status==='pending'&&o.sourceUrl===row.sourceUrl&&o.storeId===row.storeId&&o.foodId===row.foodId&&o.name===row.name&&o.packGrams===row.packGrams);
            if(old>=0)s.offers[old]={...row,id:s.offers[old].id};else if(s.offers.length<600)s.offers.push(row);else continue;
            sourceImported++;
          }
          Object.assign(live,{lastAttempt:attempted,lastSuccess:attempted,count:rows.length,error:rows.length?undefined:'Подходящие цены не найдены: странице может требоваться выбор магазина или недостаёт веса/цены.'});
        });
        imported+=sourceImported;
        return {source:source.label,count:rows.length};
      }catch(error) {
        const message=error instanceof Error?error.message:'Ошибка получения источника';
        await mutateState(owner,s=>{const live=s.sources.find(x=>x.id===source.id);if(live)Object.assign(live,{lastAttempt:attempted,error:message});});
        return {source:source.label,count:0,error:message};
      }
    }));
    const message=`Предложений на проверке: ${imported}. Источников проверено: ${sources.length}.`;
    await mutateState(owner,s=>{s.refreshMessage=message;if(scheduled)s.lastScheduled=new Date().toISOString();});
    return {imported,results,message};
  }finally{await releaseLease(lease);}
}
