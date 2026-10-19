import assert from 'node:assert/strict';
import { getTestOffers } from '../tests/fixtures.ts';
import { DEFAULT_INPUT } from '../lib/domain.ts';
const origin=process.env.EDADA_TEST_ORIGIN??'http://127.0.0.1:3000';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw new Error('Verification is local-only');
const auth=await fetch(origin+'/signin-with-chatgpt?return_to=%2F',{redirect:'manual'});
const cookie=auth.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
assert.ok(cookie,'local sign-in must set development session cookie');
async function call(action,body,headers={}){const r=await fetch(origin+'/api/'+action,{method:body===undefined?'GET':'POST',headers:{cookie,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();const value=r.headers.get('content-type')?.includes('json')?JSON.parse(text):{error:text};return {status:r.status,value};}
const before=(await call('data')).value;
const ids=[];let sourceId;
try{
  assert.equal((await fetch(origin+'/api/data')).status,401);
  assert.equal((await call('plan',{input:DEFAULT_INPUT},{Origin:'https://evil.example'})).status,403);
  assert.equal((await call('enrichment',{}, {Origin:'https://evil.example'})).status,403);
  assert.ok(before.enrichment?.summary);assert.ok(Array.isArray(before.enrichment.items));
  assert.equal((await call('enrichment',{operation:'settings',enabled:false})).status,200);
  assert.equal((await call('enrichment',{})).value.disabled,true);
  assert.equal((await call('enrichment',{operation:'settings',enabled:before.enrichment.enabled})).status,200);
  const offers=getTestOffers().slice(0,20).map((o,i)=>({...o,id:`local-smoke-${i}`,demo:false,status:'confirmed',localConfirmed:true,sourceUrl:'',evidence:'Локальные тестовые данные, не действительные цены'}));
  ids.push(...offers.map(o=>o.id));
  assert.equal((await call('offers',{offers})).status,200);
  const imported=(await call('data')).value;
  assert.equal(imported.offers.filter(o=>ids.includes(o.id)).length,20);
  const plan=await call('plan',{input:{...DEFAULT_INPUT,demo:false,meals:1,proteinMin:30},useAI:false});
  assert.equal(plan.status,200);assert.equal(plan.value.result.feasible,true);assert.ok(plan.value.result.totalCost<=1200);
  assert.equal((await call('plan',{input:DEFAULT_INPUT,useAI:true})).status,200);
  assert.ok(before.recipeLibrary);assert.ok(before.review);
  const task=before.review.tasks[0];
  if(task){
    assert.equal((await call('review',{operation:'skip',key:task.key,fingerprint:task.fingerprint})).status,200);
    const skipped=(await call('data')).value.review;assert.equal(skipped.stats.xp,before.review.stats.xp);assert.equal(skipped.remaining,before.review.remaining-1);
    assert.equal((await call('review',{operation:'undo',key:task.key})).status,200);
    assert.equal((await call('data')).value.review.remaining,before.review.remaining);
  }
  assert.equal((await call('recipes',{operation:'settings',enabled:false})).status,200);
  assert.equal((await call('data')).value.recipeLibrary.enabled,false);
  assert.equal((await call('recipes',{operation:'settings',enabled:true})).status,200);
  const malformed=await call('offers',{offers:[{...offers[0],id:'invalid',packGrams:0}]});assert.equal(malformed.status,400);
  const settings={recipeModel:before.settings.recipeModel,extractionModel:before.settings.extractionModel,cadence:before.settings.cadence};
  assert.equal((await call('settings',{...settings,geminiKey:'local-encryption-check'})).status,200);
  const safe=(await call('data')).value;assert.equal(safe.settings.geminiConfigured,true);assert.ok(!JSON.stringify(safe).includes('local-encryption-check'));
  assert.equal((await call('settings',{...settings,clearGemini:true})).status,200);
  assert.equal((await call('sources',{storeId:'magnit',url:'https://magnit.ru/',label:'Local verification source',enabled:true})).status,200);
  const d=(await call('data')).value;sourceId=d.sources.find(s=>s.label==='Local verification source')?.id;assert.ok(sourceId);
  const refresh=await call('refresh',{});assert.equal(refresh.status,200);assert.ok(refresh.value.results.some(r=>r.error?.includes('Firecrawl')));
  const readback=(await call('data')).value;assert.ok(readback.sources.find(s=>s.id===sourceId).error);assert.ok(readback.history.length>0);
  console.log('PASS: auth, origin, persisted import/plan/history, package budget, invalid input, missing API keys with cached fallback, recipe settings, review skip/undo, encrypted secret storage and refresh error readback.');
}finally{
  for(const id of ids)await call('offers',{operation:'delete',id});
  if(sourceId)await call('sources',{operation:'delete',id:sourceId});
  await call('plan',{input:DEFAULT_INPUT,useAI:false});
}
