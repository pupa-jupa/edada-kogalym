import test from 'node:test';import assert from 'node:assert/strict';
import { normalizeExtracted } from '../lib/ingestion.ts';
const source={id:'s',storeId:'magnit',url:'https://magnit.ru/product/test',label:'Каталог',enabled:true};
const now=new Date('2026-10-19T12:00:00Z');
const row={foodId:'chicken',name:'Филе 500 г',price:199,packGrams:500,evidence:'Филе, 500г, 199 ₽',localEvidence:'Когалым',priceCondition:'по карте',kcal:null,protein:null,fat:null,carbs:null,validUntil:null};
test('missing label becomes marked estimate and always requires local review',()=>{const r=normalizeExtracted(row,source,now)!;assert.equal(r.status,'pending');assert.equal(r.localConfirmed,false);assert.equal(r.nutritionEstimated,true);assert.equal(r.macros.protein,23.6);assert.equal(r.priceCondition,'по карте');});
test('unknown promotion end becomes 24h freshness rule, not claimed promotion',()=>{const r=normalizeExtracted(row,source,now)!;assert.equal(r.expiryKind,'freshness');assert.equal(r.validUntil,'2026-10-20T12:00:00.000Z');});
test('unknown weight or price cannot be invented; expired promotion is rejected',()=>{assert.equal(normalizeExtracted({...row,packGrams:null},source,now),null);assert.equal(normalizeExtracted({...row,price:0},source,now),null);assert.equal(normalizeExtracted({...row,validUntil:'2026-10-18T12:00:00Z'},source,now),null);});
