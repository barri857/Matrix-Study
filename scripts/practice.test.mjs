import test from 'node:test';
import assert from 'node:assert/strict';
import {coursePractice} from '../lib/practice.ts';
import {demoKits,validateKit} from '../lib/study.ts';
test('course variants cover all lecture banks without recursive inclusion',()=>{
 const kit=coursePractice(demoKits,1);assert.equal(kit.questions.length,18);assert.ok(validateKit(kit));
 assert.equal(new Set(kit.questions.map(q=>q.id)).size,18);
 assert.equal(coursePractice([...demoKits,kit],2).questions.length,18);
 const prompts=kit.questions.map(q=>q.prompt);for(const source of demoKits)assert.ok(prompts.includes(source.questions[0].prompt));
});
test('course variants are reproducible in content and cannot exceed 30 questions',()=>{
 const bank=Array.from({length:10},(_,i)=>({...demoKits[i%3],id:'lecture-'+i}));
 const a=coursePractice(bank,2),b=coursePractice(bank,2);assert.equal(a.questions.length,30);
 assert.deepEqual(a.questions.map(q=>q.prompt),b.questions.map(q=>q.prompt));assert.throws(()=>coursePractice([],1));
});
