import { env } from 'cloudflare:workers';
import type { Offer, Source, SavedPlan, PlanInput } from '../domain';
import { removeSyntheticData } from '../real-state';
import type {CatalogListing} from '../proshoper';
import type {NutritionCandidate} from '../nutrition';

export type UserState = { offers:Offer[];listings?:CatalogListing[];nutritionCache?:NutritionCandidate[];sources:Source[];history:SavedPlan[];input?:PlanInput;recipeModel:string;extractionModel:string;cadence:'daily'|'weekly'|'manual';gemini?:string;firecrawl?:string;lastScheduled?:string;lastAI?:number;refreshMessage?:string;automationReady?:boolean };
function initial(): UserState {return {offers:[],sources:[],history:[],recipeModel:'gemini-3.8-flash',extractionModel:'gemini-3.5-flash-lite',cadence:'manual'};}
export function database() {if(!env.DB)throw new Error('База данных пока недоступна');return env.DB;}
export async function readState(id:string):Promise<UserState> {
  const row=await database().prepare('SELECT payload FROM user_state WHERE id=?').bind(id).first<{payload:string}>();
  return row?removeSyntheticData(JSON.parse(row.payload) as UserState):initial();
}
export async function mutateState(id:string,change:(s:UserState)=>void):Promise<UserState> {
  const db=database();
  await db.prepare('INSERT OR IGNORE INTO user_state (id,payload,version) VALUES (?,?,0)').bind(id,JSON.stringify(initial())).run();
  for(let attempt=0;attempt<5;attempt++) {
    const row=await db.prepare('SELECT payload,version FROM user_state WHERE id=?').bind(id).first<{payload:string;version:number}>();
    if(!row)throw new Error('Не удалось прочитать настройки');
    const state=removeSyntheticData(JSON.parse(row.payload) as UserState);change(state);
    if(state.offers.length>600)throw new Error('Максимум 600 предложений. Удалите старые записи перед импортом.');
    const result=await db.prepare('UPDATE user_state SET payload=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify(state),id,row.version).run();
    if(result.meta.changes)return state;
  }
  throw new Error('Данные изменились параллельно. Повторите действие.');
}
export async function acquireLease(id:string,seconds=120) {
  const result=await database().prepare('INSERT INTO refresh_leases (id,expires_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at WHERE refresh_leases.expires_at < ?').bind(id,Date.now()+seconds*1000,Date.now()).run();
  return !!result.meta.changes;
}
export async function releaseLease(id:string) {await database().prepare('DELETE FROM refresh_leases WHERE id=?').bind(id).run();}
