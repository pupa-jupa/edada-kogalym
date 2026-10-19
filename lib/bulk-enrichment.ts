import {enrichmentKey,type EnrichmentRecord} from './product-enrichment.ts';
import type {CatalogListing} from './proshoper.ts';
export type RetailerTarget={key:string;urls:string[]};
export type RetailerBulkJob={signature:string;startedAt:string;completedAt?:string;targets:RetailerTarget[];cursor:number;matched:number;errors:number;referenceProducts:number};
export type BulkResult={row:CatalogListing;result:{status:'matched'|'ambiguous'|'not-found'|'error';reason:string;candidate?:EnrichmentRecord['candidate']}};
/** An in-flight automatic lookup never has authority to replace an owner's review. */
export function canApplyAutomaticRecord(current:EnrichmentRecord|undefined,started:Date):boolean{
 return !current?.userExcluded&&!current?.candidate?.userVerified&&(!current||!(Date.parse(current.checkedAt)>started.getTime()));
}
export function bulkCatalogSignature(rows:CatalogListing[]):string{return enrichmentKey({name:[...new Set(rows.map(enrichmentKey))].sort().join('|')});}
/** Every assigned task settles before checkpointing; no detached network work. */
export async function mapWithinBudget<T,R>(items:T[],concurrency:number,deadline:number,work:(item:T)=>Promise<R>,clock=Date.now):Promise<R[]>{
 let cursor=0,failed=false;let failure:unknown;const results:R[]=[];
 async function worker(){while(!failed&&cursor<items.length&&clock()<deadline){const i=cursor++;try{results[i]=await work(items[i]);}catch(error){if(!failed)failure=error;failed=true;}}}
 await Promise.all(Array.from({length:Math.min(items.length,Math.max(1,Math.min(3,concurrency)))},worker));if(failed)throw failure;return results;
}
export function mergeBulkRecords(previous:EnrichmentRecord[],results:BulkResult[],started:Date):EnrichmentRecord[]{
 const records=new Map(previous.map(r=>[r.key,r]));
 for(const {row,result} of results){const key=enrichmentKey(row),old=records.get(key);if(!canApplyAutomaticRecord(old,started))continue;if(old?.status==='matched'&&result.status!=='matched')continue;
  records.set(key,{...result,key,listingName:row.name,provider:'retailer-index',checkedAt:started.toISOString(),retryAt:new Date(started.getTime()+(result.status==='matched'?30*86400000:3600000)).toISOString(),attempts:(old?.attempts??0)+1});
 }return [...records.values()];
}
export function bulkProgress(job?:RetailerBulkJob){return job?{startedAt:job.startedAt,completedAt:job.completedAt,total:job.targets.length,checked:job.cursor,matched:job.matched,errors:job.errors,referenceProducts:job.referenceProducts}:undefined;}
