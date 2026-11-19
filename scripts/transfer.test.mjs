import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { demoKits } from '../lib/study.ts';
import { emptyWorkspace } from '../lib/workspace.ts';

const result = await build({ entryPoints: [fileURLToPath(new URL('../lib/transfer.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { createTransferBundle, parseTransferBundle, planTransferImport } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const exam = { date: '', time: '', weight: 0, notes: '' };

test('exports only whitelisted content, excluding configured credentials and account identity', () => {
  const workspace = { ...emptyWorkspace(), apiKey: 'secret-workspace-key', accountId: 'private-account', notes: [{ id: 'n1', title: 'Note', body: 'Learning content', subject: '', updatedAt: 1, apiKey: 'secret-nested-key' }] };
  const kit = { ...demoKits[0], apiKey: 'secret-kit-key', provider: 'private-provider' };
  const exported = createTransferBundle([kit], workspace, 10);
  const serialized = JSON.stringify(exported);
  assert.equal(serialized.includes('secret-'), false);
  assert.equal(serialized.includes('private-account'), false);
  assert.equal(serialized.includes('private-provider'), false);
  assert.equal(exported.workspace.notes[0].body, 'Learning content');
  assert.equal(parseTransferBundle(serialized).kits.length, 1);
});

test('import rejects invalid formats, malicious bookmarks and malformed questions', () => {
  assert.throws(() => parseTransferBundle('not-json'));
  assert.throws(() => parseTransferBundle(JSON.stringify({ format: 'other', version: 1 })));
  const bundle = createTransferBundle([demoKits[0]], emptyWorkspace(), 1);
  assert.throws(() => parseTransferBundle(JSON.stringify({ ...bundle, workspace: { ...bundle.workspace, bookmarks: [{ id: 'b1', title: 'Bad', subject: '', url: 'javascript:alert(1)' }] } })));
  assert.throws(() => parseTransferBundle(JSON.stringify({ ...bundle, kits: [{ ...demoKits[0], questions: [{ ...demoKits[0].questions[0], answer: 99 }] }] })));
});

test('merge adds fresh copies, preserves current plans, and skips repeated kits', () => {
  const own = { ...emptyWorkspace(), courses: { Biology: { Endterm: { ...exam, weight: 30 }, Final: exam } }, grades: [{ id: 'own-grade', title: 'Mine', score: 80, weight: 100 }] };
  const imported = { ...emptyWorkspace(), tasks: [{ id: 'old-task', title: 'Read', date: '', subject: '', done: false }], courses: { Biology: { Endterm: { ...exam, weight: 40 }, Final: exam } }, grades: [{ id: 'old-grade', title: 'Imported', score: 90, weight: 100 }] };
  const bundle = createTransferBundle([demoKits[0], demoKits[1]], imported, 1);
  let id = 0;
  const plan = planTransferImport([demoKits[0]], own, bundle, {}, () => `new-${++id}`, 20);
  assert.equal(plan.kits.length, 1);
  assert.equal(plan.kits[0].id, 'new-1');
  assert.equal(plan.skippedKits, 1);
  assert.equal(plan.workspace.tasks[0].id, 'new-2');
  assert.equal(plan.workspace.courses.Biology.Endterm.weight, 30);
  assert.equal(plan.workspace.grades[0].id, 'own-grade');
  assert.equal(plan.keptCoursePlans, 1);
  assert.equal(plan.keptGradeRows, 1);
  const repeated = planTransferImport([demoKits[0], ...plan.kits], plan.workspace, bundle, {}, () => `new-${++id}`, 30);
  assert.equal(repeated.kits.length, 0);
  assert.equal(repeated.workspace.tasks.length, 1);
});

test('only explicit scope choices replace matching exam plans or grade rows', () => {
  const own = { ...emptyWorkspace(), courses: { Biology: { Endterm: { ...exam, weight: 30 }, Final: exam }, Physics: { Endterm: exam, Final: exam } }, grades: [{ id: 'own-grade', title: 'Mine', score: 80, weight: 100 }] };
  const imported = { ...emptyWorkspace(), courses: { Biology: { Endterm: { ...exam, weight: 40 }, Final: exam } }, grades: [{ id: 'old-grade', title: 'Imported', score: 90, weight: 100 }] };
  const plan = planTransferImport([], own, createTransferBundle([], imported, 1), { replaceCoursePlans: true, replaceGrades: true }, () => 'new-grade', 20);
  assert.equal(plan.workspace.courses.Biology.Endterm.weight, 40);
  assert.ok(plan.workspace.courses.Physics);
  assert.equal(plan.workspace.grades[0].score, 90);
  assert.equal(plan.workspace.grades[0].id, 'new-grade');
  assert.equal(plan.keptCoursePlans, 0);
});

test('transfers retain learning progress and refuse over-capacity merges', () => {
  const studied = { ...demoKits[0], cards: [{ ...demoKits[0].cards[0], due: 100000, interval: 3, reviews: 2 }], history: [{ date: 100, score: 4, total: 6 }] };
  const bundle = parseTransferBundle(JSON.stringify(createTransferBundle([studied], emptyWorkspace(), 1)));
  const plan = planTransferImport([], emptyWorkspace(), bundle, {}, () => 'new-kit', 20);
  assert.equal(plan.kits[0].cards[0].reviews, 2);
  assert.equal(plan.kits[0].cards[0].due, 100000);
  assert.equal(plan.kits[0].history[0].score, 4);
  const full = Array.from({ length: 100 }, (_, i) => ({ ...demoKits[1], id: `existing-${i}` }));
  assert.throws(() => planTransferImport(full, emptyWorkspace(), bundle, {}, () => 'new-kit', 20), /100-kit/);
});
