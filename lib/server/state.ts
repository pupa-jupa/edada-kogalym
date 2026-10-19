import type {RecipeChatState} from '../recipe-chat';
import { env } from 'cloudflare:workers';
import type { Offer, Source, SavedPlan, PlanInput } from '../domain';
import { removeSyntheticData } from '../real-state';
import type {CatalogListing} from '../proshoper';
import type {NutritionCandidate} from '../nutrition';
import type {EnrichmentRecord} from '../product-enrichment';
import {reconcileEnrichedOffers} from '../enrichment';
import type {RetailerBulkJob} from '../bulk-enrichment';
import {packStatePayload,unpackStatePayload} from '../state-payload';
import type {SavedRecipe} from '../recipe-library';
import type {RecipeGenerationState} from '../recipe-automation';
import type {ReviewLedger} from '../product-review';

export type UserState = { offers:Offer[];listings?:CatalogListing[];nutritionCache?:NutritionCandidate[];enrichment?:EnrichmentRecord[];retailerBulk?:RetailerBulkJob;maintenancePhase?:number;recipes?:SavedRecipe[];recipeGeneration?:RecipeGenerationState;recipeChat?:RecipeChatState;reviewLedger?:ReviewLedger;enrichmentMessage?:string;enrichmentEnabled?:boolean;sources:Source[];history:SavedPlan[];input?:PlanInput;recipeModel:string;extractionModel:string;cadence:'daily'|'weekly'|'manual';gemini?:string;firecrawl?:string;lastScheduled?:string;lastAI?:number;refreshMessage?:string;automationReady?:boolean };
function initial(): UserState {return {offers:[],sources:[],history:[],recipeModel:'gemini-3.8-flash',extractionModel:'gemini-3.5-flash-lite',cadence:'manual'};}
function currentState(raw:UserState):UserState{const s=removeSyntheticData(raw);s.offers=reconcileEnrichedOffers(s.offers,s.listings??[],s.enrichment??[]);return s;}
export function database() {if(!env.DB)throw new Error('База данных пока недоступна');return env.DB;}
async function hydrate(id:string,payload:string):Promise<UserState>{return unpackStatePayload<UserState>(payload,async ids=>{const parts:Array<{id:string;payload:string}>=[];for(let i=0;i<ids.length;i+=99){const group=ids.slice(i,i+99);const rows=await database().prepare(`SELECT id,payload FROM state_payload_parts WHERE owner=? AND id IN (${group.map(()=>'?').join(',')})`).bind(id,...group).all<{id:string;payload:string}>();parts.push(...rows.results);}return parts;});}
export async function readState(id:string):Promise<UserState> {
  const row=await database().prepare('SELECT payload FROM user_state WHERE id=?').bind(id).first<{payload:string}>();
  if(!row)return initial();
  try{return currentState(await hydrate(id,row.payload));}catch(error){if(!(error instanceof Error)||!error.message.startsWith('Неполное'))throw error;const latest=await database().prepare('SELECT payload FROM user_state WHERE id=?').bind(id).first<{payload:string}>();if(!latest)throw error;return currentState(await hydrate(id,latest.payload));}
}
export async function mutateState(id:string,change:(s:UserState)=>void):Promise<UserState> {
  const db=database();
  await db.prepare('INSERT OR IGNORE INTO user_state (id,payload,version) VALUES (?,?,0)').bind(id,JSON.stringify(initial())).run();
  for(let attempt=0;attempt<5;attempt++) {
    const row=await db.prepare('SELECT payload,version FROM user_state WHERE id=?').bind(id).first<{payload:string;version:number}>();
    if(!row)throw new Error('Не удалось прочитать настройки');
    let state:UserState;try{state=currentState(await hydrate(id,row.payload));}catch(error){if(error instanceof Error&&error.message.startsWith('Неполное'))continue;throw error;}change(state);
    if(state.offers.length>5000)throw new Error('Максимум 5000 предложений. Удалите старые записи перед импортом.');
    const packed=packStatePayload(state);const statements=packed.parts.map(part=>db.prepare('INSERT INTO state_payload_parts (id,owner,payload,created_at) VALUES (?,?,?,?)').bind(part.id,id,part.payload,Date.now()));
    const results=await db.batch([...statements,db.prepare('UPDATE user_state SET payload=?,version=version+1 WHERE id=? AND version=?').bind(packed.payload,id,row.version)]);
    if(results[results.length-1].meta.changes){try{await db.prepare('DELETE FROM state_payload_parts WHERE owner=? AND created_at<?').bind(id,Date.now()-3600000).run();}catch{console.warn('Deferred state-part cleanup');}return state;}
    if(packed.parts.length)await db.batch(packed.parts.map(part=>db.prepare('DELETE FROM state_payload_parts WHERE id=? AND owner=?').bind(part.id,id)));
  }
  throw new Error('Данные изменились параллельно. Повторите действие.');
}
export async function acquireLease(id:string,seconds=120) {
  const result=await database().prepare('INSERT INTO refresh_leases (id,expires_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at WHERE refresh_leases.expires_at < ?').bind(id,Date.now()+seconds*1000,Date.now()).run();
  return !!result.meta.changes;
}
export async function releaseLease(id:string) {await database().prepare('DELETE FROM refresh_leases WHERE id=?').bind(id).run();}
