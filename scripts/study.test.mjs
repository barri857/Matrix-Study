import test from 'node:test';
import assert from 'node:assert/strict';
import { demoKits, validateKit, reviewCard, dueCards, mastery } from '../lib/study.ts';

test('all authored sample kits pass the same validation as imports', () => {
  for (const kit of demoKits) {
    const result = validateKit(kit);
    assert.equal(result.cards.length, 6);
    assert.equal(result.questions.length, 6);
    assert.equal(result.demo, true);
    assert.notEqual(result, kit);
  }
});

test('import rejects malformed questions, excessive input, and duplicate IDs', () => {
  const kit = demoKits[0];
  assert.throws(() => validateKit({ ...kit, questions: [{ ...kit.questions[0], answer: 99 }] }));
  assert.throws(() => validateKit({ ...kit, questions: [{ ...kit.questions[0], answer: 0.5 }] }));
  assert.throws(() => validateKit({ ...kit, cards: [kit.cards[0], kit.cards[0]] }));
  assert.throws(() => validateKit({ ...kit, source: 'x'.repeat(200001) }));
  assert.throws(() => validateKit({ ...kit, updatedAt: Infinity }));
  assert.throws(() => validateKit({ ...kit, color: 'red' }));
  assert.throws(() => validateKit({ ...kit, history: [{ date: 0, total: 2, score: 3 }] }));
});

test('import extracts known properties without prototype pollution', () => {
  const raw = JSON.parse(JSON.stringify(demoKits[0]));
  Object.defineProperty(raw, '__proto__', { value: { polluted: true }, enumerable: true });
  raw.apiKey = 'must-not-be-exported';
  const result = validateKit(raw);
  assert.equal(Object.hasOwn(result, '__proto__'), false);
  assert.equal(Object.hasOwn(result, 'apiKey'), false);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
});

test('review schedules real intervals and preserves the input', () => {
  const card = demoKits[0].cards[0];
  const now = 100000;
  const again = reviewCard(card, 'again', now);
  assert.equal(again.due, now + 60000);
  const good = reviewCard(again, 'good', now);
  assert.equal(good.due, now + 86400000);
  assert.equal(good.reviews, 2);
  const easy = reviewCard(card, 'easy', now);
  assert.equal(easy.due, now + 3 * 86400000);
  assert.equal(reviewCard(easy, 'good', now).interval, 6.6000000000000005);
  assert.equal(card.reviews, undefined);
});

test('due cards and mastery reflect actual review history', () => {
  const kit = { ...demoKits[0], cards: [reviewCard(demoKits[0].cards[0], 'easy', 100000)] };
  assert.equal(dueCards(kit, 100000).length, 0);
  assert.equal(dueCards(kit, 100000 + 3 * 86400000).length, 1);
  assert.equal(mastery(demoKits[0]), 0);
  assert.equal(mastery(kit), 14);
});
