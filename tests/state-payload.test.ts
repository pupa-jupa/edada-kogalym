import test from 'node:test';
import assert from 'node:assert/strict';
import {packStatePayload,unpackStatePayload} from '../lib/state-payload.ts';
test('small state stays inline and larger state roundtrips across bounded Unicode-safe parts',async()=>{
 const small=packStatePayload({ok:true});assert.equal(small.parts.length,0);
 const original={listings:['Я'.repeat(199980)+'🥣'.repeat(500000)],value:123};const packed=packStatePayload(original);assert.ok(packed.parts.length>2);assert.ok(packed.parts.every(p=>Buffer.byteLength(p.payload)<700000));
 const stored=new Map(packed.parts.map(p=>[p.id,Buffer.from(p.payload).toString('utf8')]));
 assert.deepEqual(await unpackStatePayload(packed.payload,async ids=>ids.map(id=>({id,payload:stored.get(id)!}))),original);
});
test('incomplete or duplicated chunks fail instead of loading a partial user state',async()=>{
 const packed=packStatePayload({name:'a'.repeat(500000)});
 await assert.rejects(unpackStatePayload(packed.payload,async()=>[]),/Неполное/);
 await assert.rejects(unpackStatePayload(packed.payload,async()=>[packed.parts[0],packed.parts[0]]),/Неполное/);
});
